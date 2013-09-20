/*
 * Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

/*jslint node: true, nomen: true, plusplus: true, regexp: true, evil: true */
/*globals YUI, escape */

YUI.add('mojito-pipeline-addon', function (Y, NAME) {
    'use strict';

    var MojitoActionContextDone = Y.mojito.ActionContext.prototype.done,

        // Events that tasks may experience throughout their life cycles.
        EVENT_TYPES = ['beforeDispatch', 'afterDisptach', 'beforeRender', 'afterRender', 'beforeFlush', 'afterFlush', 'onError', 'onTimeout'],

        // Actions that Pipeline executes on tasks throughout their life cycles.
        ACTIONS = ['dispatch', 'render', 'flush', 'display', 'error'],

        // A mapping between states and the corresponding event that Pipeline fires after the state is reached
        STATE_EVENT_MAP = {
            'closed'     : 'onClose',
            'dispatched' : 'afterDispatch',
            'rendered'   : 'afterRender',
            'flushed'    : 'afterFlush',
            'displayed'  : 'afterDisplay',
            'errored'    : 'onError',
            'timedOut'   : 'onTimeout'
        },

        TIMEOUT = 5000,
        NAME_DOT_PROPERTY_REGEX = /([a-zA-Z_$][0-9a-zA-Z_$\-]*)\.([^\s]+)/gm;

    // Y.mojito.ActionContext is replaced by a custom pipeline version in order
    // to hook into ac.done and render tasks according to any render rule specified.
    Y.mojito.ActionContext.prototype.done = function () {
        var doneArgs = arguments,
            pipeline = this.command.pipeline,
            task = this.command.task;

        if (!pipeline) {
            return MojitoActionContextDone.apply(this, doneArgs);
        }
        // TODO
        task.actionContext = this;
        task.doneArgs = doneArgs;
        pipeline._afterDispatch(task, task.dispatchCallback);
    };

    /**
     * Task constructor
     * @param {Object} config The configuration for the task.
     * @param {Object} pipeline Pipeline reference.
     */
    function Task(config, pipeline) {
        // The states that this task can reach during its life cycle.
        this.pushed     = false;
        this.dispatched = false;
        this.rendered   = false;
        this.flushed    = false;
        this.errored    = false;
        this.timedOut   = false;

        // Mappings of targets to which this task needs to subscribe.
        this.dispatchTargets = {};
        this.renderTargets   = {};
        this.errorTargets    = {};
        this.flushTargets    = {};
        this.displayTargets  = {};

        // Subscriptions, whose callbacks are responsible for moving this task along its life cycle.
        this.dispatchSubscription = null;
        this.renderSubscription   = null;
        this.flushSubscription    = null;
        this.errorSubscription    = null;
        this.timeoutSubscription  = null;
        this.closeSubscription    = null;

        this.dependencyTasks  = {}; // Children that should block this task from dispatching since its controller depends on them.
        this.sectionTasks     = {}; // Children that can be replaced by empty div's and flushed later.
        this.childrenTasks    = {}; // All children.
        this.embeddedChildren = []; // Children that were rendered before this task was rendered and so this task contains them.

        this.embedded = false; // This task is not considered embedded until its parent labels it as such.

        this.meta = {};

        // Merge this task's config with any section config that was provided to Pipeline.
        if (pipeline.sections[config.id]) {
            this.isSection = true;
            Y.mix(this, pipeline.sections[config.id], true);
        }

        // TODO should we initialize now?
        this.initialize(config, pipeline);
    }

    Task.prototype = {

        /**
         * Initializes the task by merging it with it config, determining subscription targets
         * and merging default tests with user rules.
         * @param {Object} config The configuration for the task.
         * @param {Object} pipeline Pipeline reference.
         */
        initialize: function (config, pipeline) {
            var self = this;

            Y.mix(this, config, true); // Merge this task with its configuration.

            Y.Array.each(this.dependencies, function (dependency) {
                self.dependencyTasks[dependency] = pipeline._getTask(dependency);
                // This task can only be dispatched after all dependencies have been rendered since this
                // task's controller depends on these tasks.
                self.dispatchTargets[dependency] = ['afterRender'];
            }, this);

            Y.Object.each(this.sections, function (section, sectionId) {
                self.sectionTasks[sectionId] = pipeline._getTask(sectionId);
                // If JS is disabled, this task should only render after each child section has rendered.
                // This ensures that the children sections become embedded in this section, without being stubbed with empty div's.
                if (!pipeline.client.jsEnabled) {
                    self.renderTargets[sectionId] = ['afterRender'];
                }
            }, this);

            Y.mix(this.childrenTasks, this.dependencyTasks);
            Y.mix(this.childrenTasks, this.sectionTasks);
            Y.Object.each(this.childrenTasks, function (childTask) {
                childTask.parent = this;
                // Children sections without a specified timeout inherit this task's timeout.
                childTask.timeout = childTask.timeout === undefined ? this.timeout : childTask.timeout;
            }, this);

            // In the client-side, if this task has a parent section, it should be displayed after its parent has been displayed.
            // This ensure that this task has a container where it can be embedded.
            if (this.parentSectionName) {
                this.displayTargets[this.parentSectionName] = ['afterDisplay'];
            }

            if (!pipeline.client.jsEnabled) {
                this.renderTest = this.noJSRenderTest;
                this.flushTest = this.noJSFlushTest;
                // The noJSFlushTest tests the Pipeline.close state so it needs to subscribe to Pipeline's onClose event.
                this.renderTargets.pipeline = ['onClose'];
            }

            // Combine default tests with user rules
            Y.Array.each(ACTIONS, function (action) {
                if (self[action]) {
                    var rule = pipeline._getRule(self, action),
                        defaultTest = self[action + 'Test'];

                    // replace the test with combined test
                    self[action + 'Test'] = function () {
                        return defaultTest.call(self, pipeline) && rule.test();
                    };

                    // add the rule targets
                    self[action + 'Targets'] = Y.mojito.util.blend(self[action + 'Targets'], rule.targets);
                }
            });
        },

        /**
         * This task may be dispatched if there are no dependencies or all have been rendered.
         * @param {Object} pipeline Pipeline reference
         * @returns {boolean} Whether to dispatch this task
         */
        dispatchTest: function (pipeline) {
            return !Y.Object.some(this.dependencyTasks, function (dependencyTask) {
                return !dependencyTask.rendered;
            });
        },

        /**
         * This task may render immediately after dispatch.
         * @param {Object} pipeline Pipeline reference
         * @returns {boolean} Whether to render this task
         */
        renderTest: function (pipeline) {
            return true;
        },

        /**
         * When JS is disabled, this task may be rendered only after either all children sections have been rendered or
         * Pipeline is closed and all pushed children sections have been rendered.
         * @param {Object} pipeline Pipeline reference
         * @returns {boolean} Whether to render this task
         */
        noJSRenderTest: function (pipeline) {
            if (pipeline.closed) {
                // if pipeline is closed return false if any child section has been pushed but not rendered
                // this means that there is a child section that hasn't been rendered and this task should wait before rendering
                return !Y.Object.some(this.sectionTasks, function (sectionTask) {
                    return !sectionTask.rendered && sectionTask.pushed;
                });
            }

            // if pipeline is still open, return false if any child section has not been rendered
            return !Y.Object.some(this.sectionTasks, function (sectionTask) {
                return !sectionTask.rendered;
            });
        },

        /**
         * This task may be flushed only if it is not already embedded in another task.
         * @param {Object} pipeline Pipeline reference
         * @returns {boolean} Whether to flush this task
         */
        flushTest: function (pipeline) {
            return !this.embedded;
        },

        /**
         * When JS is disabled, only the root should be flushed with all sections embedded within it.
         * @param {Object} pipeline Pipeline reference
         * @returns {boolean} Whether to flush this task
         */
        noJSFlushTest: function (pipeline) {
            return this.id === 'root';
        },

        /**
         * If there is a user error rule, then the default test should return true so that when it is and'ed with
         * the user rule, the user rule is the determining condition. Otherwise return false.
         * @param {Object} pipeline Pipeline reference
         * @returns {boolean} Whether to error out this task
         */
        errorTest: function () {
            return !!this.error;
        },

        /**
         * If this task hasn't been rendered, then an empty div is returned, which is used as a placeholder by
         * the Pipeline client side in order to place the rendered html on the page when ready. Otherwise this
         * returns the actual rendered html. This method can be used by a parent controller to access the content
         * of its dependent children, or by the view renderer.
         * @returns {boolean} The rendered html if available, otherwise a placeholder div,
         */
        toString: function () {
            if (!this.rendered) {
                return '<div id="' + this.id + '-section"></div>';
            }
            return this.data;
        }
    };

    /**
     * The Pipeline add-on constructor.
     */
    function Pipeline(command, adapter, ac) {
        // Ensure pipeline is a singleton across requests.
        if (!adapter.req.pipeline) {
            adapter.req.pipeline = this;
        } else {
            return adapter.req.pipeline;
        }

        // The code below is only executed once, i.e., when this add-on is attached to the
        // frame mojit's action context.

        // This represents the frame mojit
        this._frame = {
            ac: ac,
            adapter: adapter,
            context: command.context,
            params: command.params,
            data: null // This represents the object passed to the frame mojit's view. It should be specified through @configure.
        };

        // Pipeline is considered closed once close is called and there are no pending tasks.
        this.closed = false;
        // A map of all the sections specified in the configuration.
        this.sections = {};
        // A map of all the tasks known to Pipeline.
        this._tasks = {};
        // Tasks are added to this queue once they are ready to be flushed.
        this._flushQueue = [];
        // The events module used by Pipeline to manage the lifecycle of tasks.
        this._events = new Y.Pipeline.Events();
        // The number of tasks that have been pushed but not processed.
        this._pendingTasks = 0;

        this.anonymousTaskPrefix = 0;

        this._parsedRulesCache = {};
    }

    Pipeline.prototype = {

        namespace: 'pipeline',

        /**
         * called by mojito at initialization to share the resource store with this ac addon
         * @param {ResourceStore} rs the runtime ResourceStore
         */
        setStore: function (rs) {
            if (!this.client) {
                this.client = new Pipeline.Client(this._frame.ac, rs);
            }
        },

        configure: function (config, frameData) {
            config.sectionName = 'root';
            var pipeline = this,
                // walk through the sections config tree and populate the pipeline sections object
                flattenSections = function (sections, parent) {
                    Y.Object.each(sections, function (sectionConfig, sectionName) {
                        var section = pipeline.sections[sectionName] = sectionConfig || {};
                        section.sectionName = sectionName;
                        section.parentSectionName = parent && parent.sectionName;
                        flattenSections(section.sections, section);
                    });
                };

            flattenSections(config.sections, undefined);

            this._frame.data = frameData;
        },

        // TODO set frame data
        setFrameData: function (property, value) {
            this._frame.data[property] = value;
        },

        // TODO: merge with onTask and find a way to call 'on' on tasks
        on: function (targetAction, action) {
            return this.onTask('pipeline', targetAction, action);
        },

        // TODO: agree on new names for target, targetAction, action
        // and rename in all files
        onTask: function (target, targetAction, action) {
            var targets = {};
            targets[target] = [targetAction];
            return this._events.subscribe(targets, action);
        },

        close: function () {
            this._closeCalled = true;
            this._flushIfReady();
        },

        push: function (taskConfig) {
            var task = this._getTask(taskConfig);

            // keep track to know when to flush the batch
            this._pendingTasks++;
            // TODO: status of the asynchronicity of adapter rendering?
            process.nextTick(function () {
                this._push(task);
            }.bind(this));

            return task.id;
        },

        _push: function (task) {
            var pipeline = this;

            task.pushed = true;

            // TODO: have Task public, allow users to construct tasks and let them
            // call 'on' directly on tasks - put this in the Task constructor
            Y.Array.each(EVENT_TYPES, function (targetAction) {
                if (!task[targetAction]) {
                    return;
                }
                var targets = {};
                targets[task.id] = [targetAction];
                pipeline._events.subscribe(targets, task[targetAction]);
            });

            // also push any default sections of this task
            Y.Object.each(task.sections, function (config, sectionId) {
                var section = config || {};
                section.id = sectionId;
                if (section['default']) {
                    pipeline.push(section);
                }
            });

            // test task error condition - if true immediately error-out
            if (task.errorTest()) {
                return pipeline._error(task, 'Error condition returned true.', function () {
                    pipeline._taskProcessed(task);
                });
            }

            // else subscribe to error events
            task.errorSubscription = this._events.subscribe(task.errorTargets, function (events, done) {
                if (task.errorTest()) {
                    task.errorSubscription.unsubscribe();
                    pipeline._error(task, 'Error condition returned true.', done);
                }
                done();
            });

            // test task's dispatch condition - if true, immediately dispatch the task
            if (task.dispatchTest(pipeline)) {
                return pipeline._dispatch(task, function (data, meta) {
                    pipeline._taskProcessed(task);
                });
            }

            task.dispatchSubscription = this._events.subscribe(task.dispatchTargets, function (event, done) {
                if (task.dispatchTest(pipeline)) {
                    // remove subscribed events such that this action doesn't get called again
                    task.dispatchSubscription.unsubscribe();
                    pipeline._dispatch(task, done);
                } else {
                    done();
                }
            });

            // trigger dispatch after the timeout if timeout exists
            // TODO lets see if we can simplify, determine if the corner conditions still exist
            task.timeout = task.timeout === undefined ? TIMEOUT : task.timeout;
            if (task.timeout) {

                // handles the case when a timeout has been reached
                task.timeoutSubscription = setTimeout(function () {

                    task.closeSubscription.unsubscribe();
                    task.dispatchSubscription.unsubscribe();
                    // fire timeout and then dispatch
                    pipeline._timeout(task, 'data still missing after ' + task.timeout + 'ms.', function () {
                        // In case a task has a timeout that is triggered after pipeline closing,
                        // we want to block the closing until all dispatchings are finished. The events module
                        // resumes the closing after ALL the onCloseDone of the subscribers have been called;
                        var onCloseDone,
                            dispatched = false;
                        pipeline.on('onClose', function (event, done) {
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

                // handles the case where the pipeline is closed but a task still has missing dependencies
                // and so, even though the timeout hasn't been reached yet, it is imminent
                task.closeSubscription = this.on('onClose', function (event, done) {

                    if (!task.timeoutSubscription) {
                        return done();
                    }
                    task.dispatchSubscription.unsubscribe();
                    clearTimeout(task.timeoutSubscription);
                    pipeline._timeout(task, 'data still missing after pipeline closed.', function () {
                        pipeline._dispatch(task, function () {
                            done();
                        });
                    });
                });
            }

            pipeline._taskProcessed(task);
        },

        _dispatch: function (task, callback) {
            var pipeline = this;

            // copy any params specified by task config
            // add a children object to the body attribute of params
            // TODO is it necessary to get parameters from frame?
            task.params = task.params || Y.clone(pipeline._frame.params);
            task.params.body = task.params.body || {};
            task.params.body.children = task.params.body.children || {};

            // get all children tasks and sections
            // and add to the params' body
            Y.Object.each(task.childrenTasks, function (childTask) {
                if (!task.setParams) {
                    if (childTask.group) {
                        task.params.body.children[childTask.group] = task.params.body.children[childTask.group] || [];
                        task.params.body.children[childTask.group].push(childTask);
                    } else {
                        task.params.body.children[childTask.id] = childTask;
                    }
                }
            });

            pipeline._events.fire(task.id, 'beforeDispatch', function () {
                var command,
                    children = {},
                    adapter = new Y.mojito.OutputBuffer(task.id, function (error, data, meta) {
                        task.data = data;
                        // TODO lets see if we can reduce the number of times we call metaMerge
                        Y.mojito.util.metaMerge(task.meta, meta);

                        if (error) {
                            return pipeline._error(task, 'Error after dispatching.', task.renderCallback || task.dispatchCallback);
                        }

                        pipeline._afterRender(task, task.renderCallback);
                    });

                // inherit from frame adapter
                Y.mix(adapter, pipeline._frame.adapter);

                // TODO: change 'onParam' to 'beforeRender' and move all parameter setting before firing the 'beforeRender' event
                command = {
                    instance: {
                        base: task.base,
                        type: task.type,
                        action: task.action,
                        config: task.config
                    },
                    context: pipeline._frame.context,
                    params: task.params,
                    pipeline: pipeline, // TODO find another place to put this
                    task: task
                };

                // TODO: wrapping dispatch method with perf events for instrumentation purposes
                pipeline._events.fire(task.id, 'perfRenderStart', null, task);
                // TODO
                task.dispatchCallback = callback;
                pipeline._frame.ac._dispatch(command, adapter);
                pipeline._events.fire(task.id, 'perfRenderEnd', null, task);
            }, task);
        },

        _afterDispatch: function (task, callback) {
            var pipeline = this;
            task.dispatched = true;
            task.timeoutSubscription = clearTimeout(task.timeoutSubscription);
            this._events.fire(task.id, 'afterDispatch', function () {
                if (task.errored) {
                    return callback && callback();
                }
                pipeline._prepareToRender(task, callback);
            });
        },

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

        _render: function (task, callback) {
            task.renderCallback = callback;
            var pipeline = this;
            Y.Object.each(task.childrenTasks, function (childTask) {
                if (childTask.rendered) {
                    childTask.embedded = true;
                    task.embeddedChildren.push(childTask);

                    // include child's meta in parent since it is now embedded
                    Y.mojito.util.metaMerge(task.meta, childTask.meta);

                    if (childTask.isSection) {
                        // if this embedded child is in the flush queue, remove it
                        var index = pipeline._flushQueue.indexOf(childTask);
                        if (index !== -1) {
                            pipeline._flushQueue.splice(index, 1);
                        }
                        // make sure the flushSubscription is unsubscribed
                        // because it will get flushed automatically with the parent
                        return childTask.flushSubscription && childTask.flushSubscription.unsubscribe();
                    }
                }
            });
            MojitoActionContextDone.apply(task.actionContext, task.doneArgs);
        },

        _afterRender: function (task, callback) {
            var pipeline = this;
            task.rendered = true;

            pipeline._events.fire(task.id, 'afterRender', function () {
                if (task.errored) {
                    return callback && callback();
                }
                pipeline._prepareToFlush(task, callback);
            }, task);
        },

        _prepareToFlush: function (task, callback) {
            var pipeline = this;

            // If this task is a not a section or is embedded, then it does not need to be flushed.
            if (!task.isSection || task.embedded) {
                return callback && callback();
            }

            if (task.flushTest(pipeline)) {
                return pipeline._addToFlushQueue(task, callback);
            }

            // subscribe to flush events
            task.flushSubscription = pipeline._events.subscribe(task.flushTargets, function (event, done) {
                if (task.flushTest(pipeline)) {
                    // remove subscribed events such that this action doesn't get called again
                    task.flushSubscription.unsubscribe();
                    return pipeline._addToFlushQueue(task, done);
                }
                done();
            });
            return callback && callback();
        },

        _addToFlushQueue: function (task, callback) {
            this._flushQueue.push(task);
            return callback && callback();
        },

        // get the cached rule or parse it if it doesnt exist
        _getRule: function (task, action) {
            var rule = task[action];
            if (!this._parsedRulesCache[rule]) {
                this._parsedRulesCache[rule] = this._parseRule(task, action);
            }
            return this._parsedRulesCache[rule];
        },

        _parseRule: function (task, action) {
            var targets = {},
                rule = task[action],
                pipeline = this;

            rule = rule.replace(NAME_DOT_PROPERTY_REGEX, function (expression, objectId, property) {
                // add a target if one found in this bit of the rule
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
                targets: targets,
                rule: rule,
                test: function () {
                    return eval(rule);
                }
            };
        },

        // TODO: make public
        _getTask: function (config) {
            var task;

            // get by task id
            if (typeof config === 'string' || typeof config === 'number') {
                config = {
                    id: config
                };
                // create task if one with this id doesn't exist
                task = this._tasks[config.id] = this._tasks[config.id] || new Task(config, this);
                return task;
            }

            if (config.id === undefined) {
                config.id = 'autoId' + this.anonymousTaskPrefix++ + '@' + (config.type || config.base);
            }

            // get by config object - if it doesn't exist just create it
            task = this._tasks[config.id];
            if (task) {
                task.initialize(config, this);
            } else {
                task = this._tasks[config.id] = new Task(config, this);
            }

            return task;
        },

        _error: function (task, error, callback) {
            var pipeline = this;

            Y.log(task.id + ' had an error: ' + error, 'error');
            task.errored = true;
            task.data = '<span>ERROR</span>';

            this._events.fire(task.id, 'onError', function () {
                var done = function () {
                    pipeline._prepareToFlush(task, callback);
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
                return;

                // TODO modify this to work with refactored code
                var errorTask = task.errorContent;
                // if there is no fallback, actificially render the task to ''
                if (!errorTask) {
                    task.data = '';
                    task.rendered = true;
                    pipeline._events.fire(task.id, 'afterRender', function () {
                        return done && done(task.data, task.meta);
                    }, task);
                } else {
                    // else replace the original task with an error task in the pipeline
                    errorTask.id = task.id + '-errored-at-' + Date.now();
                    // and try to redispatch
                    pipeline._dispatch(pipeline._getTask(errorTask), function (data, meta) {
                        pipeline._getTask(task.id).data = pipeline._getTask(errorTask.id).data;
                        return done && done(data, meta);
                    });
                }
            }, task, error);
        },

        _timeout: function (task, message, done) {
            Y.log(task.id + ' timedout: ' + message, 'error');
            task.timedOut = true;
            task.data = '<span>TIMEOUT</span>';
            this._events.fire(task.id, 'onTimeout', done, task, message);
        },

        // keep track of the number of processed tasks in this batch and flush it if we're done
        _taskProcessed: function (task) {
            this._pendingTasks--;
            this._flushIfReady();
        },

        _flushIfReady: function () {
            var pipeline = this;
            if (this._pendingTasks > 0) {
                return;
            }

            if (this._closeCalled) {
                this.closed = true;
                this._events.fire('pipeline', 'onClose', function () {
                    pipeline._flushQueuedTasks(function () {
                        // report any task that hasnt been flushed
                        Y.Object.each(pipeline._tasks, function (task) {
                            if (!task.flushed && task.pushed) {
                                Y.log(task.id + '(' + task.type + ') remained unflushed.', 'error');
                            }
                        });
                    });
                });
            } else {
                this._flushQueuedTasks();
            }
        },

        // wrap each task, fire its flush event and flush everything when all are done
        _flushQueuedTasks: function (done) {
            var pipeline = this,
                i,
                rootData = {
                    meta: {},
                    data: ''
                },
                flushData = {
                    meta: {},
                    data: ''
                },
                task,
                numFlushedTasks = 0,
                flush = function (task) {
                    pipeline._events.fire(task.id, 'beforeFlush', function () {
                        task.flushed = true;

                        // remove any error subscription
                        if (task.errorSubscription) {
                            task.errorSubscription.unsubscribe();
                        }

                        // TODO should we remove firing of events that are useless?
                        pipeline._events.fire(task.id, 'afterFlush', null, task);

                        if (task.embedded) {
                            return;
                        }

                        if (task.id === 'root') {
                            rootData.data = task.data;
                            rootData.meta = task.meta;
                        } else {
                            flushData.data += pipeline._serializeTask(task);
                            Y.mojito.util.metaMerge(flushData.meta, task.meta);
                        }

                        ++numFlushedTasks;

                        if (numFlushedTasks === pipeline._flushQueue.length) {
                            pipeline.__flushQueuedTasks(rootData, flushData);
                            return done && done();
                        }

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
            if (this.closed && this._flushQueue.length === 0) {
                pipeline.__flushQueuedTasks(rootData, flushData);
                return done && done();
            }

            for (i = 0; i < this._flushQueue.length; i++) {
                task = this._flushQueue[i];
                // flush any embedded descendants
                flushEmbeddedDescendants(task, flush);

                flush(task);
            }
        },

        // flush the wrapped tasks within a <script> tag, fire pipeline flush
        __flushQueuedTasks: function (rootData, flushData) {
            var pipeline = this;

            flushData.data = flushData.data ? '<script>' + flushData.data + '</script>' : '';

            Y.mojito.util.metaMerge(flushData.meta, rootData.meta);
            this._events.fire('pipeline', 'afterFlush', function () {
                if (pipeline.closed) {
                    pipeline._frame.ac.done('<!-- Flush Start -->\n' + rootData.data + flushData.data + '</body></html>' + '\n<!-- Flush End -->\n\n', flushData.meta);
                } else {
                    pipeline._frame.ac.flush('<!-- Flush Start -->\n' + rootData.data + flushData.data + '\n<!-- Flush End -->\n\n', flushData.meta);
                }
                pipeline._flushQueue = [];
            }, flushData);
        },

        /**
         * Serializes the task into a JS statement that calls the Pipeline client push method once the task is flushed
         * to the client. The push method tasks an object with several properties including 'markup', which is an
         * escaped string representation of the task's html.
         * @param {Object} task The task to serialize
         * @return {String} The serialized task
         */
        _serializeTask: function (task) {
            var pipeline = this,
                serialized = 'pipeline.push({' +
                    'markup: "' + escape(task.data) + '"';

            Y.Object.each(task, function (property, propertyName) {
                var embeddedChildren = [];
                switch (propertyName) {
                case 'id':
                    serialized += ',\n' + propertyName + ': "' + property + '"';
                    break;
                case 'displayTargets':
                case 'embeddedChildren':
                    Y.Array.each(property, function (section, index) {
                        embeddedChildren.push(section.id);
                    });
                    serialized += ',\n' + propertyName + ": " + JSON.stringify(embeddedChildren);
                    break;
                case 'displayTest':
                    serialized += ',\n' + propertyName + ': function (pipeline) {' +
                            'return eval(\'' +
                                pipeline._getRule(task, 'display').rule + '\');}';
                    break;
                case 'timedOut':
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

    // TODO do we need a separate class for this
    Pipeline.Client = function (ac, rs) {
        this.script = rs.pipeline.client;
        this.unminifiedScript = rs.pipeline.unminifiedClient;
        this.jsEnabled = ac.jscheck.status() === 'enabled';
        // TODO: document that pipeline htmlframe can accept a jscheck boolean configuration
        ac.jscheck.run();
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