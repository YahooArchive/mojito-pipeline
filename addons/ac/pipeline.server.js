/* Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

/*jslint node: true, nomen: true, plusplus: true, regexp: true, evil: true */
/*globals YUI, escape */

/**
 * Exposes the main access points into the pipeline.
 * Implements the public ac.pipeline addon and private `Task` class.
 */

YUI.add('mojito-pipeline-addon', function (Y, NAME) {
    'use strict';

    var RuleParser,
        MojitoActionContextDone = Y.mojito.ActionContext.prototype.done,

        // Events that tasks may experience throughout their lifecycles.
        EVENT_TYPES = ['beforeDispatch', 'afterDispatch', 'beforeRender', 'afterRender', 'beforeFlush', 'afterFlush', 'onError', 'onTimeout'],

        // Actions that Pipeline executes on tasks throughout their lifecycles.
        ACTIONS = ['dispatch', 'render', 'flush', 'display', 'error'],

        // A mapping between states and the corresponding event that Pipeline fires after the state is reached.
        STATE_EVENT_MAP = {
            'closed'     : 'onClose',
            'dispatched' : 'afterDispatch',
            'rendered'   : 'afterRender',
            'flushed'    : 'afterFlush',
            'displayed'  : 'afterDisplay',
            'errored'    : 'onError',
            'timedout'   : 'onTimeout'
        },

        // Default timeout in ms for dispatching a task.
        TIMEOUT = 5000;

    // Y.mojito.ActionContext is replaced by a custom pipeline version in order
    // to hook into ac.done and render tasks according to any render rule specified.
    Y.mojito.ActionContext.prototype.done = function () {
        var doneArgs = arguments,
            pipeline = this.command.pipeline,
            task = this.command.task;

        if (!pipeline) {
            return MojitoActionContextDone.apply(this, doneArgs);
        }

        pipeline._events.fire(task.id, 'dispatchEnd', null, task);

        // TODO find a better way to keep track of actionContext and done arguments.
        task.actionContext = this;
        task.doneArgs = doneArgs;
        pipeline._afterDispatch(task, task.dispatchCallback);
    };

    // Responsible for parsing user specified rules in the configuration passed to Pipeline.
    RuleParser = {
        // Regular expression for extracting variable names and their properties, e.g., "var1.prop1".
        NAME_DOT_PROPERTY_REGEX: /([a-zA-Z_$][0-9a-zA-Z_$\-]*)\.([a-zA-Z_$][0-9a-zA-Z_$]*)/gm,

        // A cache used such that rules are only parsed once for all requests.
        cachedParsedRules: {},

        /**
         * Returns the parsed rule, getting it from cache if available.
         * @param {String} rule The user specified rule.
         */
        getParsedRule: function (rule) {

            var parseRule = function () {
                    var targets = {},
                        parsedRule = 'true';

                    parsedRule = rule.replace(RuleParser.NAME_DOT_PROPERTY_REGEX, function (expression, objectId, property) {
                        // Determine the target event based on the state specified in the rule.
                        if (STATE_EVENT_MAP[property]) {
                            targets[objectId] = targets[objectId] || [];
                            targets[objectId].push(STATE_EVENT_MAP[property]);
                        }
                        switch (objectId) {
                        case 'pipeline':
                            return 'pipeline.' + property;
                        default:
                            return 'pipeline._getTask("' + objectId + '").' + property;
                        }
                    });

                    return {
                        rule: parsedRule,
                        targets: targets
                    };
                };

            // Parse the rule and cache it if not already cached
            if (!RuleParser.cachedParsedRules[rule]) {
                RuleParser.cachedParsedRules[rule] = parseRule();
            }
            return RuleParser.cachedParsedRules[rule];
        }
    };

    /**
     * @class Task
     * @constructor
     * @param {Object} id An optional id for the task.
     * @param {Object} pipeline Pipeline reference.
     */
    function Task(id, pipeline) {
        this.id = id;
        this.pipeline = pipeline;

        // The states that this task can reach during its lifecycle.
        // TODO consider having a single variable state
        this.pushed     = false;
        this.dispatched = false;
        this.rendered   = false;
        this.flushed    = false;
        this.errored    = false;
        this.timedout   = false;

        // Mappings of targets to which this task needs to subscribe.
        this.dispatchTargets = {};
        this.renderTargets   = {};
        this.errorTargets    = {};
        this.flushTargets    = {};
        this.displayTargets  = {};

        // Subscriptions, whose callbacks are responsible for moving this task along its lifecycle.
        this.dispatchSubscription = null;
        this.renderSubscription   = null;
        this.flushSubscription    = null;
        this.errorSubscription    = null;
        this.timeoutSubscription  = null;
        this.closeSubscription    = null;

        this.childrenTasks    = {}; // All children.
        this.embeddedChildren = []; // Children that were rendered before this task was rendered and so this task contains them.

        this.embedded = false; // This task is not considered embedded until its parent labels it as such.

        this.blockParent = false; // By default a task does not block its parent unless its specs indicates otherwise.
        this.parentId  = null; // A task has no parent unless a task specifies it as its child in its specs.

        this.specs = {}; // All the specs defined during initialization and by the parent.

        this.data = ''; // The rendered html of this task.
        this.meta = {}; // The associated meta data of this task.
    }

    Task.prototype = {

        /**
         * Initializes this task by determining subscription targets
         * and merging default tests with user rules.
         * @param {Object} specs the configuration for this task.
         * @param {Boolean} Whether this task initialized successfully.
         */
        initialize: function (specs) {
            var self = this,
                pipeline = self.pipeline,
                type;

            // Report a warning if a task specifies that is it blocking while its pushed parent is not aware that it is blocking.
            // This can result in the parent dispatching before the blocking task, since it didn't know that it should be blocked.
            if (self.parentTask && !self.specs.blockParent && specs.blockParent) {
                Y.log('Task ' + self.id + ' has specified to block its parent but its parent, '
                    + self.parentId + ' has been pushed without knowing that '
                    + self.id + ' should block it. Make sure that blocking children specify blockParent '
                    + 'before or when its parent is pushed', 'warn', NAME);
            }

            // Merge the new specs. self.specs may already contain specs specified by this task's parent, added through addSpecs below.
            Y.mix(self.specs, specs);

            // Report a warning if a task is blocking yet it specifies flush or display rules.
            // These rules have no effect when a task blocks its parent because it ends up embedded and
            // its flushing and displaying follows its parent.
            if (self.blockParent && (self.specs.flush || self.specs.display)) {
                Y.log('Task ' + self.id + ' blocks its parent but also specifies a flush or display rule. '
                    + 'These rules are ignored since the task will end up embedded in its parent '
                    + 'and will be flushed and displayed with its parent.', 'warn', NAME);
                delete self.specs.flush;
                delete self.specs.display;
            }

            if (!self.specs.type && !self.specs.base) {
                Y.log('Error initializing task ' + self.id + ': tasks must have a base or a type.', 'error', NAME);
                return false;
            }

            // Generate an id consisting of this task's base or type and the next available number for that base/type.
            if (self.id === undefined || self.id === null) {
                type = self.specs.base || self.specs.type;
                pipeline._typeCount[type] = pipeline._typeCount[type] || 0;
                pipeline._typeCount[type]++;
                self.id = type + '@' + pipeline._typeCount[type];

                pipeline._tasks[self.id] = self;
            }

            Y.Object.each(self.specs.children, function (child, childId) {
                var childTask = pipeline._getTask(childId);
                self.childrenTasks[childId] = childTask;

                // Make sure child specs is an object.
                self.specs.children[childId] = child = Y.Lang.isObject(child) ? child : {};

                if (child.blockParent) {
                    // This task can only be dispatched after all blocking children have been rendered.
                    self.dispatchTargets[childId] = ['afterRender'];
                } else if (!pipeline.client.enabled) {
                    // If Pipeline client is disabled, this task should only render after each child has rendered.
                    // This ensures that the children become embedded in this task, without being stubbed with empty div's.
                    self.renderTargets[childId] = ['afterRender'];
                }
            });

            // Add specs to pipeline.specs and establish the parent-child relationships among descendant tasks.
            (function addSpecs(parentSpecs, parentId) {
                pipeline.specs[parentId] = Y.mix(pipeline.specs[parentId] || {}, parentSpecs);

                Y.Object.each(parentSpecs.children, function (childSpecs, childId) {
                    var childTask = pipeline._getTask(childId);

                    // Make sure the child hasn't already been claimed as a child by another task, otherwise
                    // multiple tasks would try to embed the same child.
                    if (childTask.parentId !== null && childTask.parentId !== parentId) {
                        Y.log('Task ' + parentId + ' has specified ' + childId + ' as a child, however '
                            + childTask.parentId + ' has already claimed it as a child: '
                            + 'task id\'s should be unique.', 'error', NAME);
                        return;
                    }

                    childSpecs.id = childId;
                    childTask.parentId = parentId;
                    childTask.blockParent = !!childSpecs.blockParent;

                    // Merge this child task's specs with any previously defined specs.
                    Y.mix(childTask.specs, childSpecs);

                    addSpecs(childSpecs, childId);
                });
            }(specs, self.id)); // Add only the new specs since self.specs, may contain previously processed specs.

            Y.Object.each(self.childrenTasks, function (childTask) {
                childTask.parentTask = self;
                // Children without a specified timeout inherit this task's timeout.
                if (childTask.timeout === undefined) {
                    childTask.timeout = self.timeout;
                }
            });

            if (!pipeline.client.enabled) {
                self.renderTest = self.noJSRenderTest;
                self.flushTest = self.noJSFlushTest;
                // The noJSFlushTest tests the Pipeline.close state so it needs to subscribe to Pipeline's onClose event.
                self.renderTargets.pipeline = ['onClose'];
            }

            // Combine default tests with user rules.
            Y.Array.each(ACTIONS, function (action) {
                if (self.specs[action]) {

                    var defaultTest = self[action + 'Test'],
                        parsedRule = RuleParser.getParsedRule(self.specs[action], pipeline),
                        ruleTest = function () {
                            return eval(parsedRule.rule);
                        };

                    // Replace the action test with a combined test containing the default test and the rule test.
                    self[action + 'Test'] = function () {
                        return defaultTest.call(self, pipeline) && ruleTest();
                    };

                    // Combine the rule targets with any existing targets for this action.
                    self[action + 'Targets'] = Y.mojito.util.blend(self[action + 'Targets'], parsedRule.targets);
                }
            });

            return true;
        },

        /**
         * This task may be dispatched if there are no blocking children or all have been rendered.
         * This function will be combined with a corresponding, user-defined rule if it exists.
         * @param {Object} pipeline Pipeline reference.
         * @returns {boolean} Whether to dispatch this task.
         */
        dispatchTest: function (pipeline) {
            return !Y.Object.some(this.childrenTasks, function (childTask) {
                return childTask.blockParent && !childTask.rendered;
            });
        },

        /**
         * By default this method always returns true since a task should render immediately after dispatch
         * unless it has rendering dependencies.
         * This function will be combined with a corresponding, user-defined rule if it exists.
         * @param {Object} pipeline Pipeline reference.
         * @returns {boolean} Whether to render this task.
         */
        renderTest: function (pipeline) {
            return true;
        },

        /**
         * When JS is disabled, this task may be rendered only after either all children have been rendered or
         * Pipeline is closed and all pushed children have been rendered.
         * @param {Object} pipeline Pipeline reference.
         * @returns {boolean} Whether to render this task.
         */
        noJSRenderTest: function (pipeline) {
            if (pipeline.closed) {
                // If pipeline is closed return false if any child has been pushed but not rendered
                // this means that there is a child that hasn't been rendered and this task should wait before rendering
                return !Y.Object.some(this.childrenTasks, function (childTask) {
                    return !childTask.rendered && childTask.pushed;
                });
            }

            // If pipeline is still open, return false if any child has not been rendered.
            return !Y.Object.some(this.childrenTasks, function (childTask) {
                return !childTask.rendered;
            });
        },

        /**
         * By default this method always returns true since a task should be flushed immediately after rendering
         * unless it has flush dependencies. Blocking tasks, and non-blocking tasks that are already embedded, are never considered
         * for flushing. This function will be combined with a corresponding, user-defined rule if it exists.
         * @param {Object} pipeline Pipeline reference.
         * @returns {boolean} Whether to flush this task.
         */
        flushTest: function (pipeline) {
            return true;
        },

        /**
         * When JS is disabled, no task should be flushed since the client side cannot process serialized tasks.
         * @param {Object} pipeline Pipeline reference.
         * @returns {boolean} Whether to flush this task.
         */
        noJSFlushTest: function (pipeline) {
            return false;
        },

        /**
         * If there is a user error rule, then the default test should return true so that when it is and'ed with
         * the user rule, the user rule is the determining condition. Otherwise return false.
         * This function will be combined with a corresponding, user-defined rule if it exists.
         * @param {Object} pipeline Pipeline reference.
         * @returns {boolean} Whether to error out this task.
         */
        errorTest: function (pipeline) {
            return !!this.specs.error;
        },

        /**
         * If this task hasn't been rendered, then an empty div is returned, which is used as a placeholder by
         * the Pipeline client side in order to place the rendered html on the page when ready. Otherwise this
         * returns the actual rendered html. This method can be used by a parent controller to access the content
         * of its dependent children, or by the view renderer.
         * @returns {boolean} The rendered html if available, otherwise a placeholder div.
         */
        toString: function () {
            if (this.embedded) {
                return this.data;
            }

            if (// If this task has not been rendered then a stub is created for it.
                !this.rendered ||
                    // If this task has already been flushed, then a stub is created instead of
                    // embedding the task since this task will be embedded in the client side.
                    this.flushed ||
                    // If this task has a flush or a display rule, then it should not be embedded,
                    // since doing so would prevent the flush and display rules from being applied.
                    (this.specs.flush || this.specs.display)
            ) {
                return '<div id="' + this.id + '-section"></div>';
            }

            // If this task has a parent that hasn't been rendered,
            // then it will be embedded inside its parent with its rendered data.
            if (this.parentTask && !this.parentTask.rendered) {
                this.embedded = true;
                this.parentTask.embeddedChildren.push(this);

                // Include this task's meta data in its parent since it is now embedded.
                Y.mojito.util.metaMerge(this.parentTask.meta, this.meta);

                if (!this.blockParent) {
                    // If this embedded child is in the flush queue, remove it.
                    var index = this.pipeline._taskFlushQueue.indexOf(this);
                    if (index !== -1) {
                        this.pipeline._taskFlushQueue.splice(index, 1);
                    }
                    // Make sure the flushSubscription is unsubscribed
                    // because it will get flushed automatically with the parent.
                    if (this.flushSubscription) {
                        this.flushSubscription.unsubscribe();
                    }
                }
            }

            return this.data;
        },

        /**
         * Returns the id of this task followed by its base or type.
         * @return {String}
         */
        getName: function () {
            return this.id + ' (' + ((this.specs && (this.specs.base || this.specs.type)) || 'Unknown type') + ')';
        },

        /**
         * Returns this task's current state. The errored and timedout states take precedence
         * over the non-error rendered and pushed states, respectively.
         * @returns {String} This task's current state.
         */
        getState: function () {
            var currentState = 'unpushed',
                self = this;
            Y.Array.some(['flushed', 'errored', 'rendered', 'dispatched', 'timedout', 'pushed'], function (state) {
                if (self[state]) {
                    currentState = state;
                    return true;
                }
            });
            return currentState;
        },

        /**
         * Returns a detailed description of this task. Includes key properties such as current state, its parent,
         * and the rule and dependencies for its next state.
         * @return {String} A detailed description of this task.
         */
        getDetails: function () {
            var details,
                pipeline = this.pipeline,
                state = this.getState(),
                nextAction;

            details = '- Properties: ' + ['state=' + state, 'embedded=' + this.embedded, 'blockParent=' + this.blockParent, 'timeout=' + this.timeout].join(', ');
            details += this.parentTask ? '\n- Parent: ' + this.parentTask.getName() : '';

            // Determine the next action for this task and append the corresponding rule to the details.
            switch (state) {
            case 'pushed':
            case 'timedout':
                details += '\n- Dispatch rule: dispatch after blocking children have rendered' +
                    (this.specs.dispatch ? ' and (' + this.specs.dispatch + ')' : '');
                nextAction = 'dispatch';
                break;
            case 'dispatched':
                details += '\n- Render rule: render after dispatch'  +
                    (this.specs.render ? ' and (' + this.specs.render + ')' : '');
                nextAction = 'render';
                break;
            case 'rendered':
            case 'errored':
                // The flush rule only applies to non-embedded, non-blocking children.
                if (!this.embedded && !this.blockParent) {
                    details += '\n- Flush rule: flush after rendering'  +
                        (this.specs.flush ? ' and (' + this.specs.flush + ')' : '');
                    nextAction = 'flush';
                }
                break;
            default:
            }

            if (!nextAction) {
                return details;
            }

            // List the dependencies for the next action.
            details += '\n- ' + nextAction.charAt(0).toUpperCase() + nextAction.substring(1) + ' dependencies:';
            if (Y.Object.isEmpty(this[nextAction + 'Targets'])) {
                details += ' no dependencies';
                return details;
            }
            Y.Object.each(this[nextAction + 'Targets'], function (events, dependencyId) {
                if (dependencyId === 'pipeline') {
                    details += '\n  - pipeline: state=' + (pipeline.closed ? 'closed' : 'open') +
                        ', jsEnabled=' + pipeline.client.jsEnabled + ', pipelineClient=' + pipeline.client.enabled;
                    return;
                }
                var dependency = pipeline._getTask(dependencyId);
                details += '\n  - ' + dependency.getName() + ': state=' + dependency.getState();
            });

            return details;
        },

        /**
         * Stringifies this task's markup by escaping various characters
         * and placing the markup in single quotes.
         * @return {String} The stringified markup.
         */
        stringify: function () {
            return '\'' + this.data.replace(/\\/g, '\\\\')   // Escape the escape character.
                                   .replace(/\r?\n/g, '\\n') // Remove carriage returns and escape new lines.
                                   .replace(/\'/g, '\\\'')   // Escape single quotes.
                                   // Make sure ending script tags are escaped to prevent HTML parsing errors
                                   // in old browsers.
                                   .replace(/<\/script\s*>/g, '<\\/script>') + '\'';
        },

        /**
         * Serializes the task into a JS statement that calls the Pipeline client push method once the task is flushed
         * to the client. The push method tasks an object with several properties including 'markup', which is an
         * escaped string representation of the task's html.
         * @param {Object} task The task to serialize.
         * @return {String} The serialized task.
         */
        serialize: function () {
            var self = this,
                serialized = 'pipeline.push({' +
                    'markup: ' + self.stringify();

            Y.Object.each(self, function (property, propertyName) {
                var embeddedChildren = [];
                switch (propertyName) {
                case 'id':
                    serialized += ',\n' + propertyName + ': "' + property + '"';
                    break;
                case 'displayTargets':
                    serialized += ',\n' + propertyName + ": " + JSON.stringify(property);
                    break;
                case 'embeddedChildren':
                    Y.Array.each(property, function (child, index) {
                        embeddedChildren.push(child.id);
                    });
                    serialized += ',\n' + propertyName + ": " + JSON.stringify(embeddedChildren);
                    break;
                case 'displayTest':
                    serialized += ',\n' + propertyName + ': function (pipeline) {' +
                            'return eval(\'' +
                                RuleParser.getParsedRule(self.specs.display).rule + '\');}';
                    break;
                case 'timedout':
                case 'errored':
                    serialized += ',\n' + propertyName + ': ' + property;
                    break;
                default:
                }
            });

            serialized += '});\n';

            return serialized;
        }
    };

    /**
     * @class mojito.addons.ac.pipeline
     * @constructor
     */
    function Pipeline(command, adapter, ac) {
        var req = adapter.req,
            jsEnabled;

        // Ensure pipeline is a singleton across requests.
        if (!req.globals) {
            req.globals = {};
        }
        if (!req.globals.pipeline) {
            req.globals.pipeline = this;
        } else {
            return req.globals.pipeline;
        }

        jsEnabled = ac.jscheck.status() === 'enabled';

        // The code below is only executed once, i.e., when this add-on is attached to the
        // frame mojit's action context.

        /**
         * Representation of the Pipeline client. Includes property enabled, jsEnabled, and script.
         * property client
         * @type Object
         */
        this.client = {
            // The Pipeline client is flushed if the pipelineClient option is not set to false
            // and JS is enabled; otherwise the page is flushed all at once without the Pipeline client.
            enabled: ac.config.get('pipelineClient') !== false && jsEnabled,
            jsEnabled: jsEnabled,
            script: null // String representation of the Pipeline client code, this is set in the setStore method.
        };

        /**
         * Pipeline is considered closed once close is called and there are no pending tasks.
         * property closed
         * @type boolean
         */
        this.closed = false;

        /**
         * Mapping of task id to its specs. This is not needed internally but serves as a convenience for users.
         * property specs
         * @type Object
         */
        //
        this.specs = {};

        // Representation of the frame mojit.
        this._frame = {
            ac: ac,
            adapter: adapter,
            context: command.context,
            params: command.params,
            data: null // This represents the object passed to the frame mojit's view. It should be specified through @configure.
        };

        // A map of all the tasks known to Pipeline.
        this._tasks = {};
        // Tasks are added to this queue once they are ready to be flushed. Once pipeline is done processing all
        // the task that it can for the moment, the flush data is flushed and this queue is emptied.
        this._taskFlushQueue = [];
        // Flush handlers that flush data to the client are queued to ensured flush order is maintained.
        this._pipelineFlushQueue = [];
        // The events module used by Pipeline to manage the lifecycle of tasks.
        this._events = new Y.Pipeline.Events();
        // The number of tasks that have been pushed but not processed.
        this._pendingTasks = 0;
        // A map of different types of tasks and their count. This is used to generate an id where the count represents
        // the current number of anonymous tasks of that type.
        this._typeCount = {};

        ac.jscheck.run();
    }

    Pipeline.prototype = {

        namespace: 'pipeline',

        /**
         * Called by Mojito during initialization in order to share the resource store with this add-on.
         * @param {ResourceStore} rs The runtime ResourceStore.
         */
        setStore: function (rs) {
            if (!this.client.script) {
                this.client.script = rs.pipeline.client;
            }
        },

        /**
         * Should only be called by the frame mojit once in order to initialize Pipeline with a configuration,
         * and give Pipeline access to the data object that it will pass to its view.
         * @param {Object} frameData The data object that will be passed to the frame mojit's view.
         */
        initialize: function (frameData) {

            // This gives Pipeline access to the frame's view data, which can be modified through the Pipeline.setFrameData method.
            this._frame.data = frameData;
        },

        /**
         * Sets a property in the frame's data object that will be passed to its view.
         * @param {String} property The frame data property to be set.
         * @param {Any} value The value to set the frame data property.
         */
        setFrameData: function (property, value) {
            this._frame.data[property] = value;
        },

        /**
         * Asynchronous version of @on. Uses the Pipeline events object to subscribe to a target and its event,
         * and pass an asynchronous callback.
         * @param {String} target A task id or 'pipeline', whose event is of interest.
         * @param {String} event The target's event to subscribe to.
         * @param {Function} callback The callback function to call once the event is fired for the target.
         * @returns {Object} The subscription, whose unsubscribe method can be called to prevent the callback
         * from executing on subsequent events
         */
        onAsync: function (target, event, callback) {
            var targets = {};
            targets[target] = [event];
            return this._events.subscribe(targets, callback);
        },

        /**
         * Uses the Pipeline events object to subscribe to a target and its event, and pass a synchronous callback.
         * @param {String} target A task id or 'pipeline', whose event is of interest.
         * @param {String} event The target's event to subscribe to.
         * @param {Function} callback The callback function to call once the event is fired for the target.
         * @returns {Object} The subscription, whose unsubscribe method can be called to prevent the callback
         * from executing on subsequent events
         */
        on: function (target, event, callback) {
            var syncCallback = function (event, done) {
                var optionalArgs = Array.prototype.slice.call(arguments, 0).slice(2),
                    syncArgs = [event].concat(optionalArgs);
                callback.apply(null, syncArgs);
                done();
            };

            return this.onAsync(target, event, syncCallback);
        },

        /**
         * Indicates to Pipeline that no more tasks will be pushed.
         */
        close: function () {
            if (!this._closeCalled) {
                this._closeCalled = true;
                this._flushIfReady();
            }
        },

        /**
         * Pushes a new task into the Pipeline. The processing is done asynchronously,
         * i.e upon return a task with the id given in @taskSpecs will exist and be scheduled for later dispatch.
         * @param {Object} taskSpecs The task's configuration object.
         * @returns {String} The task's id if specified, else its generated id. null if there was an error.
         */
        push: function (taskSpecs) {
            // As a convenience, users can pass a string when pushing a task. This is considered the id of the task.
            taskSpecs = Y.Lang.isString(taskSpecs) ? {id: taskSpecs} : taskSpecs;

            var task = taskSpecs.id !== undefined && taskSpecs.id !== null ? this._getTask(taskSpecs.id) : new Task(null, this);

            // A task should not be pushed multiple times as this can result in duplicate dispatching/rendering/flushing
            // and can cause unexpected behavior since events might be fired multiple times for this task.
            if (task.pushed) {
                Y.log('Task ' + task.id + ' was pushed multiple times.', 'error', NAME);
                return null;
            }

            if (!task.initialize(taskSpecs)) {
                return null;
            }

            // Tasks should not be pushed after closing the Pipeline as this can result in
            // unexpected behavior such as the task not getting flushed.
            if (this._closeCalled) {
                Y.log('Task ' + task.id + ' was pushed after closing the Pipeline.', 'error', NAME);
                return null;
            }

            task.pushed = true;

            // Push any autoPush children of this task. Children with autoPush set to true get pushed automatically by pipeline
            // instead of the user.
            Y.Object.each(task.specs.children, function (childSpecs, childId) {
                if (childSpecs.autoPush) {
                    this.push(childId);
                }
            }, this);

            // Keeps track of how many pushed tasks are pending since they haven't been processed yet.
            // A task is considered processed when it has finally been pushed to the flush queue or
            // if it needs to wait for some dependencies before reaching its next state.
            this._pendingTasks++;

            // This allows the push method to be asynchronous, such that pipeline can process the task on the next event loop tick.
            process.nextTick(function () {
                this._push(task);
            }.bind(this));

            return task.id;
        },

        /**
         * After a task is pushed asynchronously using the push method, this method picks up on the next tick in order
         * subscribe to any events and prepare to dispatch the task.
         * @param {Task} task The task to be dispatched.
         */
        _push: function (task) {
            var pipeline = this;

            // Subscribe to any event specified in the task's config, which the task is interested about itself.
            Y.Array.each(EVENT_TYPES, function (event) {
                var targets;
                if (task.specs[event]) {
                    targets = {};
                    targets[task.id] = [event];
                    pipeline._events.subscribe(targets, task.specs[event]);
                }
            });

            // Test this task's error condition; error out and return if it passes.
            if (task.errorTest()) {
                return pipeline._error(task, 'Error condition returned true.', function () {
                    // After this task is errored out, this task should be considered processed
                    pipeline._taskProcessed(task);
                });
            }

            // Subscribe to error event, in order to error out this task if its error condition passes.
            task.errorSubscription = this._events.subscribe(task.errorTargets, function (events, done) {
                if (task.errorTest()) {
                    task.errorSubscription.unsubscribe();
                    pipeline._error(task, 'Error condition returned true.', done);
                }
                done();
            });

            this._prepareToDispatch(task, function () {
                // This should be called once this task has reached the end of its lifecycle or it has been postponed
                // due to dependencies.
                pipeline._taskProcessed(task);
            });
        },

        /**
         * Tests the dispatch condition and dispatches if true, otherwise subscribes to dependencies and sets a timeout
         * to force a dispatch if dependencies aren't satisfied after some time.
         * @param {Task} task The task that was dispatched.
         * @param {Function} callback The callback passed to maintain synchronous flow throughout events.
         */
        _prepareToDispatch: function (task, callback) {
            var pipeline = this;
            // Test this task's dispatch condition; dispatch this task and return if it passes
            if (task.dispatchTest(pipeline)) {
                return pipeline._dispatch(task, callback);
            }

            // If the dispatch test did not pass, then subscribe to this task's dispatch targets in order to dispatch
            // this task once the condition passes.
            task.dispatchSubscription = this._events.subscribe(task.dispatchTargets, function (event, done) {
                if (task.dispatchTest(pipeline)) {
                    // remove subscribed events such that this action doesn't get called again
                    task.dispatchSubscription.unsubscribe();
                    pipeline._dispatch(task, done);
                } else {
                    done();
                }
            });

            // Since this task was not dispatched immediately, set a timeout in order to dispatch this task after the specified time,
            // regardless of its unsatisfied dependencies.
            if (task.timeout === undefined) {
                task.timeout = TIMEOUT;
            }

            if (task.timeout) {

                // Handles the case when a timeout has been reached.
                task.timeoutSubscription = setTimeout(function () {

                    task.closeSubscription.unsubscribe();
                    task.dispatchSubscription.unsubscribe();
                    // Fire timeout and then dispatch.
                    pipeline._timeout(task, 'dispatch dependencies remained unsatisfied after ' + task.timeout + 'ms.', function () {
                        // In case a task has a timeout that is triggered after pipeline closing,
                        // we want to block the closing until all dispatchings are finished. The events module
                        // resumes the closing after ALL the onClose of the subscribers have been called;
                        var onCloseDone,
                            dispatched = false;

                        pipeline.onAsync('pipeline', 'onClose', function (event, done) {
                            if (dispatched) {
                                done();
                            } else {
                                onCloseDone = done;
                            }
                        });

                        pipeline._dispatch(task, function () {
                            if (onCloseDone) {
                                onCloseDone();
                            }
                            dispatched = true;
                        });
                    });
                }, task.timeout);

                // Handles the case where the pipeline is closed but a task still has missing dependencies
                // and so, even though the timeout hasn't been reached yet, it is imminent.
                task.closeSubscription = this.onAsync('pipeline', 'onClose', function (event, done) {

                    if (!task.timeoutSubscription) {
                        return done();
                    }
                    task.dispatchSubscription.unsubscribe();

                    clearTimeout(task.timeoutSubscription);
                    task.timeoutSubscription = null;

                    pipeline._timeout(task, 'dispatch dependencies still unsatisfied after pipeline closed.', function () {
                        pipeline._dispatch(task, function () {
                            done();
                        });
                    });
                });
            }

            callback();
        },

        /**
         * Dispatches a task by executing its controller.
         * @param {Task} task The task to dispatch.
         * @param {Function} callback The callback passed to maintain synchronous flow throughout events.
         */
        _dispatch: function (task, callback) {
            var pipeline = this;

            // Set the parameters of this task. As is normally done in Mojito,
            // if no custom parameters exist, the dispatcher's parameters are used.
            task.params = task.specs.params || Y.clone(pipeline._frame.params);

            // All children tasks are made available to a task's mojit through params.body.children.
            task.params.body = task.params.body || {};
            task.params.body.children = task.params.body.children || {};
            Y.Object.each(task.childrenTasks, function (childTask) {
                if (!task.setParams) {
                    // Tasks can have a 'group' property such that they are group together in an array
                    // with other siblings of the same group.
                    if (childTask.specs.group) {
                        task.params.body.children[childTask.specs.group] = task.params.body.children[childTask.specs.group] || [];
                        task.params.body.children[childTask.specs.group].push(childTask);
                    } else {
                        task.params.body.children[childTask.id] = childTask;
                    }
                }
            });

            // The beforeDispatch event can be subscribed to in order to modify the task before it is dispatched.
            pipeline._events.fire(task.id, 'beforeDispatch', function () {
                var command,
                    afterRenderCallback = function (error, data, meta) {
                        // Do not continue lifecycle if this task has already errored out.
                        if (task.errored) {
                            return (task.renderCallback || task.dispatchCallback)();
                        }

                        pipeline._events.fire(task.id, 'renderEnd', null, task);

                        task.data = data;

                        // TODO lets see if we can reduce the number of times we call metaMerge
                        Y.mojito.util.metaMerge(task.meta, meta);

                        if (error) {
                            // The callback passed to @_error is the renderCallback if available else the dispatchCallback.
                            // The only time the renderCallback does not exist is if there was an error during dispatching, and
                            // so the dispatchCallback should be called.
                            return pipeline._error(task, 'Error after dispatching.', task.renderCallback || task.dispatchCallback);
                        }

                        pipeline._afterRender(task, task.renderCallback);
                    },
                    adapter = new Y.mojito.OutputBuffer(task.id, afterRenderCallback);

                // Inherit from frame adapter.
                Y.mix(adapter, pipeline._frame.adapter);

                command = {
                    instance: {},
                    context: pipeline._frame.context,
                    params: task.params,
                    // Pipeline and task are added to the command since the modified ActionContext.done method
                    // needs to know if the mojit was executed through pipeline in order to call Pipeline._afterDispatch
                    // TODO try finding a better way to do this
                    pipeline: pipeline,
                    task: task
                };

                Y.mix(command.instance, task.specs, true, ['base', 'type', 'action', 'config']);

                // Keep track of this method's callback, since this callback should be passed to Pipeline._afterDispatch after dispatching.
                // TODO try finding a better way to keep track of the callback.
                task.dispatchCallback = callback;
                // Dispatch will call the controller, which in turn calls ac.done, which calls @_afterDispatch.
                pipeline._events.fire(task.id, 'dispatchStart', null, task);
                pipeline._frame.ac._dispatch(command, adapter);
            }, task);
        },

        /**
         * Sets the dispatch state to true and fires the afterDispatch event.
         * This is called by the patched ac.done of the controller.
         * @param {Task} task The task that was dispatched.
         * @param {Function} callback The callback passed to maintain synchronous flow throughout events.
         */
        _afterDispatch: function (task, callback) {
            var pipeline = this;
            task.dispatched = true;

            // This task has been dispatched, so the timeout is no longer needed.
            clearTimeout(task.timeoutSubscription);
            task.timeoutSubscription = null;

            this._events.fire(task.id, 'afterDispatch', function () {
                // Do not continue lifecycle if this task has errored out.
                if (task.errored) {
                    return callback && callback();
                }
                pipeline._prepareToRender(task, callback);
            }, task);
        },

        /**
         * Tests the render condition and renders if true, otherwise subscribes to dependencies in order to
         * render once the dependencies' conditions are satisfied.
         * @param {Task} task The task that was dispatched.
         * @param {Function} callback The callback passed to maintain synchronous flow throughout events.
         */
        _prepareToRender: function (task, callback) {
            var pipeline = this;
            if (task.renderTest(pipeline)) {
                return pipeline._render(task, callback);
            }

            task.renderSubscription = this._events.subscribe(task.renderTargets, function (event, done) {
                if (task.renderTest(pipeline)) {
                    // remove subscribed events such that this action doesn't get called again
                    task.renderSubscription.unsubscribe();
                    return pipeline._render(task, done);
                }
                done();
            });
            callback();
        },

        /**
         * Renders a task by calling the real ActionContext.done method, which renders the view
         * using the data obtained after dispatch.
         * @param {Task} task The task to render.
         * @param {Function} callback The callback passed to maintain synchronous flow throughout events.
         */
        _render: function (task, callback) {
            var pipeline = this;

            // Keep track of this method's callback, since this callback should be passed to Pipeline._afterRender after rendering.
            // TODO try finding a better way to keep track of the callback.
            task.renderCallback = callback;

            pipeline._events.fire(task.id, 'renderStart', null, task);

            // Call the original ac.done
            MojitoActionContextDone.apply(task.actionContext, task.doneArgs);
        },

        /**
         * Sets the rendered state to true and fires the afterRender event.
         * @param {Task} task The task that was rendered.
         * @param {Function} callback The callback passed to maintain synchronous flow throughout events.
         */
        _afterRender: function (task, callback) {
            var pipeline = this;
            task.rendered = true;

            pipeline._events.fire(task.id, 'afterRender', function () {
                // Do not continue lifecycle if this task has errored out.
                if (task.errored) {
                    return callback && callback();
                }
                pipeline._prepareToFlushEnqueue(task, callback);
            }, task);
        },

        /**
         * Tests the flush condition and adds to flush queue if true, otherwise subscribes to dependencies in order to
         * add to flush queue once the dependencies' conditions are satisfied.
         * @param {Task} task The task that was dispatched.
         * @param {Function} callback The callback passed to maintain synchronous flow throughout events.
         */
        _prepareToFlushEnqueue: function (task, callback) {
            var pipeline = this;

            // If this task blocks its parent or is embedded, then it does not need to be flushed.
            if (task.blockParent || task.embedded) {
                return callback && callback();
            }

            if (task.flushTest(pipeline)) {
                return pipeline._flushEnqueue(task, callback);
            }

            task.flushSubscription = pipeline._events.subscribe(task.flushTargets, function (event, done) {
                if (task.flushTest(pipeline)) {
                    // remove subscribed events such that this action doesn't get called again
                    task.flushSubscription.unsubscribe();
                    return pipeline._flushEnqueue(task, done);
                }
                done();
            });
            return callback && callback();
        },

        /**
         * Queues the task so that it can be flushed with others once Pipeline is ready.
         * @param {Task} task The task that was rendered.
         * @param {Function} callback The callback passed to maintain synchronous flow throughout events.
         */
        _flushEnqueue: function (task, callback) {
            // Remove any error subscription since this task has already reached the flushed state.
            if (task.errorSubscription) {
                task.errorSubscription.unsubscribe();
            }

            this._taskFlushQueue.push(task);
            return callback && callback();
        },

        /**
         * Begins the process of flushing queued tasks if there are no more pending tasks.
         */
        _flushIfReady: function () {
            var pipeline = this;
            if (this._pendingTasks > 0) {
                return;
            }

            if (this._closeCalled) {
                this.closed = true;
                this._events.fire('pipeline', 'onClose', function () {
                    var erroredTasks = {};
                    pipeline._fireTasksFlushEvents(function () {
                        // Report any task that ended in an erroneous state after pipeline closed.
                        Y.Object.each(pipeline._tasks, function (task) {
                            var endState = pipeline.client.enabled ? 'flushed' : 'rendered',
                                errorMessage;

                            if (pipeline.client.enabled && task.id !== 'root' && task.flushed && !task.parentTask) {
                                errorMessage = task.getName() + ' was flushed but no parent ever claimed it as a child, ' +
                                    'so it has no place to be displayed. ' +
                                    'Make sure that this task is specified as a child.';
                            } else if (task.blockParent && !task.flushed && task.rendered && !task.embedded) {
                                if (task.parentId) {
                                    errorMessage = task.getName() + ' was rendered but its parent ' +  task.parentId +
                                        ' did not embed it and it is marked to block its parent. Make sure that its parent places this task in its view.';
                                } else {
                                    errorMessage = task.getName() + ' was rendered but it doesn\'t have a parent to embed it. ' +
                                        'Make sure that this task is listed as a child of another task.';
                                }
                            } else if (task.pushed && !task[endState]) {
                                errorMessage = task.getName() + ' was never ' + endState + '. ' +
                                    'Make sure dependencies are satisfied in order for this task to reach the ' + endState + ' state.';
                            }

                            if (errorMessage) {
                                errorMessage = errorMessage + '\n' + task.getDetails();
                                erroredTasks[task.id] = {
                                    task: task,
                                    error: errorMessage
                                };
                                Y.log(errorMessage, 'error', NAME);
                            }
                        });
                        if (!Y.Object.isEmpty(erroredTasks)) {
                            pipeline._events.fire('pipeline', 'onError', null, erroredTasks);
                        }

                        pipeline._events.fire('pipeline', 'afterClose');
                    });
                });
            } else {
                this._fireTasksFlushEvents();
            }
        },

        /**
         * Fires the flush event for all tasks in the flush queue, including embedded descendants. Also
         * Concatenates the serialized non-embedded tasks.
         */
        _fireTasksFlushEvents: function (callback) {
            var pipeline = this,
                i,
                flushData = {
                    meta: {},
                    data: ''
                },
                task,
                numFlushedTasks = 0,
                flush = function (task) {
                    pipeline._events.fire(task.id, 'beforeFlush', function () {
                        task.flushed = true;

                        pipeline._events.fire(task.id, 'afterFlush', function () {
                            if (task.embedded) {
                                return;
                            }

                            Y.mojito.util.metaMerge(flushData.meta, task.meta);

                            // Add this task's parent to the display targets such that on the client side it can
                            // listen to its parent afterDisplay event in order to display itself.
                            // If no parent has claimed this task yet, then this task should listen to all tasks' afterDisplay
                            // event such that it can display itself once there is a stub for it.
                            if (task.id !== 'root') {
                                var parent = task.parentId || '*',
                                    displayTargets = {};

                                displayTargets[parent] = ['afterDisplay'];
                                task.displayTargets = Y.mojito.util.blend(task.displayTargets, displayTargets);
                            }

                            flushData.data += task.serialize();

                            ++numFlushedTasks;

                            if (numFlushedTasks === pipeline._taskFlushQueue.length) {
                                pipeline._flushQueuedTasks(flushData);
                                return callback && callback();
                            }
                        }, task);
                    }, task);
                },
                flushEmbeddedDescendants = function (task) {
                    var j,
                        embeddedChild;
                    for (j = 0; j < task.embeddedChildren.length; j++) {
                        embeddedChild = task.embeddedChildren[j];
                        flush(embeddedChild);
                        flushEmbeddedDescendants(embeddedChild);
                    }
                };

            // if the pipeline is closed but there is no data pipeline still has to flush the closing tags
            if (this.closed && this._taskFlushQueue.length === 0) {
                pipeline._flushQueuedTasks(flushData);
                return callback && callback();
            }

            for (i = 0; i < this._taskFlushQueue.length; i++) {
                task = this._taskFlushQueue[i];
                // flush any embedded descendants
                flushEmbeddedDescendants(task, flush);

                flush(task);
            }
        },

        /**
         * Flushes the serialized tasks that were queued.
         */
        _flushQueuedTasks: function (flushData) {
            var pipeline = this,
                flushHandler = function () {
                    if (pipeline.closed) {
                        pipeline._frame.ac.done(flushData.data + '</body></html>', flushData.meta);
                    } else {
                        pipeline._frame.ac.flush(flushData.data, flushData.meta);
                    }
                };

            // Empty the task flush queue as all the task queued to be flushed have been processed.
            pipeline._taskFlushQueue = [];

            // Queue this flush's handler to ensure that flushes occur in the same order that they were initiated.
            // Flushes can become out of order if subscribers of pipeline.beforeFlush are asynchronous and the callbacks
            // to multiple fired pipeline.beforeFlush events are called out of order.
            // It is important to maintain flush order in order ensure serialized tasks appear between the frame and end tags.
            pipeline._pipelineFlushQueue.push(flushHandler);

            // If Pipeline is closed, let the Pipeline client know.
            if (pipeline.closed && pipeline.client.enabled) {
                flushData.data += 'pipeline.close();';
            }

            flushData.data = flushData.data ? '<script>' + flushData.data + '</script>' : '';

            this._events.fire('pipeline', 'beforeFlush', function () {
                var queuedFlushHandler;

                // Mark this flush handler as ready since all subscribers to pipeline.beforeFlush are done
                // and the associated flush data is ready to be flushed.
                flushHandler.ready = true;

                // Execute ready flush handlers in order, as long as no earlier flush handler
                // is still not ready.
                while (pipeline._pipelineFlushQueue.length > 0) {
                    queuedFlushHandler = pipeline._pipelineFlushQueue[0];
                    if (queuedFlushHandler.ready) {
                        queuedFlushHandler();
                        pipeline._pipelineFlushQueue.splice(0, 1);
                    } else {
                        // Don't call the other callbacks since they should be called in the order
                        // of the queue.
                        break;
                    }
                }
            }, flushData);
        },

        /**
         * Decrements the count of pending tasks and calls flushIfReady in order to flush the flush queue
         * once there are no more pending tasks
         * @param {Object} task
         */
        _taskProcessed: function (task) {
            this._pendingTasks--;
            this._flushIfReady();
        },

        /**
         * Gets a task by id. Creates an new Task if it hasn't already been created.
         * @param {String} id The id of the task to retrieve.
         */
        _getTask: function (id) {
            if (!this._tasks[id]) {
                this._tasks[id] = new Task(id, this);
            }
            return this._tasks[id];
        },

        /**
         * Processes a task after an error by setting an error message, firing an error event,
         * and moving the task along its lifecycle starting from the state the error interrupted.
         * @param {Object} task
         * @param {String} error
         * @param {Function} callback
         */
        _error: function (task, error, callback) {
            var pipeline = this;

            Y.log(task.id + ' had an error: ' + error, 'error', NAME);
            task.errored = true;
            task.data = '<span>ERROR</span>';

            // Unsubscribe from any dispatch/render subscriptions since the onError event
            // will move this task along the dispatch and render states
            if (task.dispatchSubscription) {
                task.dispatchSubscription.unsubscribe();
            }
            if (task.renderSubscription) {
                task.renderSubscription.unsubscribe();
            }

            this._events.fire(task.id, 'onError', function () {
                var done = function () {
                    pipeline._prepareToFlushEnqueue(task, callback);
                };

                if (!task.dispatched) {
                    pipeline._afterDispatch(task, function () {
                        pipeline._afterRender(task, done);
                    });
                } else if (!task.rendered) {
                    pipeline._afterRender(task, done);
                } else {
                    return done();
                }
            }, task, error);
        },

        /**
         * Processes a task after a timeout by setting a timeout error and firing a timeout event.
         * @param {Object} task
         * @param {String} message
         * @param {Object} callback
         */
        _timeout: function (task, message, callback) {
            var pipeline = this,
                hint = '',
                dispatchTest;

            if (task.specs.dispatch) {
                dispatchTest = function () {
                    return eval(RuleParser.getParsedRule(task.specs.dispatch, pipeline).rule);
                };
            }

            // Find any blocking child that was not rendered, thus preventing the task from dispatching.
            Y.Object.some(task.childrenTasks, function (childTask) {
                if (childTask.blockParent && !childTask.rendered) {
                    hint = ' Blocking child \'' + childTask.getName() + '\' was never rendered, which prevented this task from dispatching.';
                    return true;
                }
            });

            // Determine if the user-defined dispatch rule returns false.
            if (dispatchTest && !task.dispatchTest()) {
                hint += hint ? ' Also, the' : ' The';
                hint += ' user-defined dispatch rule (' + task.specs.dispatch + ') returned false.';
            }

            message += hint + ' Make sure dispatch dependencies are satisfied.\n';
            message += task.getDetails();

            Y.log(task.getName() + ' timedout: ' + message, 'error', NAME);
            task.timedout = true;
            task.data = '<span>TIMEOUT</span>';
            this._events.fire(task.id, 'onTimeout', callback, task, message);
        }
    };

    Y.namespace('mojito.addons.ac').pipeline = Pipeline;

}, '0.0.1', {
    requires: [
        'base-base',
        'target-action-events',
        'mojito',
        'mojito-action-context',
        'mojito-params-addon',
        'mojito-jscheck-addon',
        'mojito-output-buffer',
        'mojito-util'
    ]
});
