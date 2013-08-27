/*jslint node: true, nomen: true, plusplus: true, regexp: true */
/*globals YUI, escape */

YUI.add('mojito-pipeline-addon', function (Y, NAME) {
    'use strict';

    var vm = require('vm'),

        businessScripts = {},
        PROPERTYEVENTSMAP = {
            'closed'   : 'onClose',
            'rendered' : 'afterRender',
            'flushed'  : 'afterFlush',
            'displayed': 'afterDisplay',
            'errored'  : 'onError',
            'timedOut' : 'onTimeout'
        },
        NAME_DOT_PROPERTY_REGEX = /([a-zA-Z_$][0-9a-zA-Z_$\-]*)\.([^\s]+)/gm,
        EVENT_TYPES = ['beforeRender', 'afterRender', 'beforeFlush', 'afterFlush', 'onError', 'onClose', 'onTimeout'],
        ACTIONS = ['render', 'flush', 'display', 'error'];

    // TODO: Document what this private utility method does...
    function mergeEventTargets() {
        var i, j, targets, target, targetAction, mergedTargets = {};

        for (i = 0; i < arguments.length; i++) {
            targets = arguments[i];
            for (target in targets) {
                if (targets.hasOwnProperty(target)) {
                    mergedTargets[target] = mergedTargets[target] || [];
                    for (j = 0; j < targets[target].length; j++) {
                        targetAction = targets[target][j];
                        if (mergedTargets[target].indexOf(targetAction) === -1) {
                            mergedTargets[target].push(targetAction);
                        }
                    }
                }
            }
        }

        return mergedTargets;
    }

    function Pipeline(command, adapter, ac) {
        if (!adapter.req.pipeline) {
            adapter.req.pipeline = this;
        } else {
            Y.mix(this, adapter.req.pipeline);
            return;
        }
        this.command = command;
        this.adapter = adapter;
        this.ac = ac;

        this.data = {
            closed: false,
            events: new Y.Pipeline.Events(),
            tasks: {},
            numUnprocessedTasks: 0,
            sections: {},
            flushQueue: []
        };
        this._parsedRules = {};
        this._flushQueue = [];
        this._vmContext = vm.createContext({ pipeline: this });
    }

    function Task(task, pipeline) {
        this.initialize(task, pipeline);
    }

    Task.prototype = {
        initialize: function (task, pipeline) {
            var self = this;
            this.pipeline = pipeline;

            // the states this tasks get along its lifecycle stages
            this.pushed   = false;
            this.rendered = false;
            this.flushed  = false;
            this.errored  = false;
            this.timedOut = false;

            // the tasks this task observes along its lifecycle stages
            this.renderTargets  = {};
            this.errorTargets   = {};
            this.flushTargets   = {};
            this.displayTargets = {};

            this.childrenTasks    = {}; // children that should block the task rendering
            this.childrenSections = {}; // children that can be replaced by an empty <div> stub
            this.embeddedChildren = []; // children that had their markup ready and did not need an empty <div> stub

            // merge task config with the config that pipeline has for this task ...
            if (pipeline.data.sections[task.id]) {
                this.isSection = true;
                Y.mix(this, pipeline.data.sections[task.id], true);
            }
            Y.mix(this, task, true); // ... and the config that is given when pushing

            // render after all dependencies (blocking)
            Y.Array.each(task.dependencies, function (dependency) {
                self.childrenTasks[dependency] = pipeline._getTask(dependency);
                self.renderTargets[dependency] = ['afterRender', 'onError'];
            });

            // render after all sections iff js is not enabled on the client
            Y.Object.each(this.sections, function (childSection, childSectionId) {
                self.childrenSections[childSectionId] = pipeline._getTask(childSectionId);
                if (!pipeline.client.jsEnabled) {
                    self.renderTargets[childSectionId] = ['afterRender', 'onError'];
                }
            });

            // by default display after the parent task does
            if (this.parent) {
                this.displayTargets[this.parent.sectionName] = ['afterDisplay'];
            }

            if (!pipeline.client.jsEnabled) {
                this.renderTest = this.noJSRenderTest;
                this.flushTest = this.noJSFlushTest;
                // add client to render targets since the noJSRenderTest
                // needs to know about pipeline's closed state
                this.renderTargets.pipeline = ['onClose'];
            } else {

                // by default flush when this task renders or errors out
                this.flushTargets[this.id] = ['afterRender', 'onError'];

                // combine default tests with user rules
                Y.Array.each(ACTIONS, function (action) {
                    if (self[action]) {
                        var rule = pipeline._getRule(self, action);

                        // replace the test with combined test
                        self[action + 'Test'] = function () {
                            return Task.prototype[action + 'Test'].bind(self).call() &&
                                rule.test();
                        };

                        // add the rule targets
                        self[action + 'Targets'] = mergeEventTargets(self[action + 'Targets'], rule.targets);
                    }
                });

            }

            // if task is root
            if (this.id === 'root') {
                // renderTest should return true if js is disabled
                this.renderTest = pipeline.client.jsEnabled ? this.renderTest : function () { return true; };
                // flush test should always be false
                this.flushTest = function () { return false; };
            }


        },

        noJSRenderTest: function (pipeline) {
            // test original renderTest which checks for children dependencies
            if (!Task.prototype.renderTest.bind(this).call()) {
                return false;
            }

            if (pipeline.data.closed) {
                // if pipeline is closed return false if any child section
                // has been pushed but not rendered
                return !Y.Object.some(this.childrenSections, function (childSection, childSectionId) {
                    var childSectionTask = pipeline._getTask(childSectionId);
                    return !childSectionTask.rendered && childSectionTask.pushed;
                });
            }

            // if pipeline is still open, return false if
            // any child section has not been rendered
            return !Y.Object.some(this.childrenSections, function (childSection, childSectionId) {
                var childSectionTask = pipeline._getTask(childSectionId);
                return !childSectionTask.rendered;
            });
        },

        // default renderTest: "no child task is not rendered"
        renderTest: function (pipeline) {
            return !Y.Object.some(this.childrenTasks, function (task) {
                return !task.rendered;
            });
        },
        // default: "never flush anything", let the root handle it
        noJSFlushTest: function (pipeline) {
            return false;
        },
        // default: "flush if this task is rendered"
        flushTest: function (pipeline) {
            return this.rendered;
        },
        // default: "if rule exists, default to true, else default to false"
        errorTest: function () {
            return !!this.error;
        },

        // can I embed my markup directly into my parent?
        isEmbeddable: function () {
            return !this.render && !this.flush && !this.display && !this.flushed;
        },
        // get full markup if it exists and if I am embeddable, else stub
        getMarkup: function (embeddable) {
            if (!embeddable || !this.rendered) {
                return '<div id="' + this.id + '-section"></div>';
            }
            return this.data;
        },
        // wrap markup into a pipeline.push() with other useful info to place the markup in the skeleton
        wrap: function () {
            var wrapped = 'pipeline.push({' +
                'markup: "' + escape(this.data) + '"';

            Y.Object.each(this, function (property, propertyName) {
                switch (propertyName) {
                case 'id':
                    wrapped += ',\n' + propertyName + ': "' + property + '"';
                    break;
                case 'displayTargets':
                case 'embeddedChildren':
                    Y.Array.each(property, function (section, index) {
                        property[index] = section.id;
                    });
                    wrapped += ',\n' + propertyName + ": " + JSON.stringify(property);
                    break;
                case 'displayTest':
                    wrapped += ',\n' + propertyName + ': function (pipeline) {' +
                            'return eval(\'' +
                                this.pipeline._getRule(this, 'display').rule + '\');}';
                    break;
                default:
                }
            }, this);

            wrapped += '});\n';

            return wrapped;
        }
    };

    Pipeline.Client = function (pipelineStore) {
        this.script = pipelineStore.client;
        this.unminifiedScript = pipelineStore.unminifiedClient;
        this.jsEnabled = true;
    };

    // rendering adapter for mojito
    Pipeline.Adapter = function (task, pipelineAdapter, callback) {
        this.callback = callback;
        this.task = task;
        this.data = '';
        this.meta = {};
        Y.mix(this, pipelineAdapter);
    };

    Pipeline.Adapter.prototype = {
        done: function (data, meta) {
            this.data += data;
            // this trick is to call metaMerge only after the first pass
            this.meta = (this.meta ? Y.mojito.util.metaMerge(this.meta, meta) : meta);
            this.callback(this.data, this.meta);
        },

        flush: function (data, meta) {
            this.data += data;
            // this trick is to call metaMerge only after the first pass
            this.meta = (this.meta ? Y.mojito.util.metaMerge(this.meta, meta) : meta);
        },

        error: function (err) {
            this.callback(null, null, err);
        }
    };

    Pipeline.prototype = {
        namespace: 'pipeline',

        setStore: function (rs) {
            this.client = new Pipeline.Client(rs.pipeline);
        },

        configure: function (config) {
            config.sectionName = 'root';
            var pipeline = this,
                getSections = function (sections, parent) {
                    Y.Object.each(sections, function (sectionConfig, sectionName) {
                        pipeline.data.sections[sectionName] = sectionConfig;
                        pipeline.data.sections[sectionName].sectionName = sectionName;
                        pipeline.data.sections[sectionName].parent = parent;
                        getSections(sectionConfig.sections, sectionConfig);
                    });
                };

            getSections(config.sections, undefined);
        },

        on: function (targetAction, action) {
            return this.data.events.subscribe({
                'pipeline': [targetAction]
            }, action);
        },

        close: function () {
            this.data.closed = true;
            if (!this.data.numUnprocessedTasks) {
                this._taskProcessed();
            }
        },

        push: function (taskConfig) {

            var pipeline = this,
                renderSubscription,
                errorSubscription,
                timeoutSubscription,
                task = pipeline._getTask(taskConfig);

            // keep track to know when to flush the batch
            this.data.numUnprocessedTasks++;
            Y.log('[pipeline.server.js:308] pushed [' + this.data.numUnprocessedTasks + ']:' + task.id, 'info', NAME);
            task.pushed = true;

            // subscribe to any events specified by the task
            Y.Array.each(EVENT_TYPES, function (targetAction) {
                if (!task[targetAction]) {
                    return;
                }
                var targets = {};
                targets[task.id] = [targetAction];
                pipeline.data.events.subscribe(targets, task[targetAction]);
            });

            // also push any default sections of this task
            Y.Object.each(task.sections, function (config, sectionId) {
                config.id = sectionId;
                if (config['default']) {
                    pipeline.push(config);
                }
            });

            // subscribe to flush events
            if (task.isSection) {
                task.flushSubscription = this.data.events.subscribe(task.flushTargets, function (event, done) {
                    if (task.flushTest(pipeline)) {
                        // remove subscribed events such that this action doesn't get called again
                        task.flushSubscription.unsubscribe();
                        pipeline._addToFlushQueue(task);
                    }
                    done();
                });

            }

            // test task error condition - if true immediately error-out
            if (task.errorTest()) {
                return pipeline._error(task, function () {
                    pipeline._taskProcessed(task);
                });
            }
            // else subscribe to error events
            errorSubscription = this.data.events.subscribe(task.errorTargets, function (events, done) {
                if (task.errorTest()) {
                    errorSubscription.unsubscribe();
                    pipeline._error(task);
                }
                done();
            });

            // test task's render condition - if true, immediately render the task
            if (task.renderTest(pipeline)) {
                pipeline._render(task, function (data, meta) {
                    pipeline._taskProcessed(task);
                });
                return;
            }
            // else subscribe to render events
            renderSubscription = this.data.events.subscribe(task.renderTargets, function (event, done) {
                if (task.renderTest(pipeline)) {
                    // if there is a timeout, clear it
                    if (timeoutSubscription) {
                        clearTimeout(timeoutSubscription);
                    }
                    // remove subscribed events such that this action doesn't get called again
                    renderSubscription.unsubscribe();
                    pipeline._render(task, done);
                } else {
                    done();
                }
            });

            // trigger rendering after the timeout if timeout exists
            if (task.timeout) {
                timeoutSubscription = setTimeout(function () {
                    // clear rendering listeners
                    renderSubscription.unsubscribe();
                    // fire timeout and then render
                    pipeline._timeout(task, function () {
                        pipeline._render(task);
                    });
                }, task.timeout);
            }

            pipeline._taskProcessed(task);
        },

        // get the cached rule or parse it if it doesnt exist
        _getRule: function (task, action) {
            var rule = task[action];
            if (!this._parsedRules[rule]) {
                this._parsedRules[rule] = this._parseRule(task, action);
            }
            return this._parsedRules[rule];
        },

        _parseRule: function (task, action) {
            var targets = {},
                rulz = task[action],
                self = this;

            rulz = rulz.replace(NAME_DOT_PROPERTY_REGEX, function (expression, objectId, property) {
                // add a target if one found in this bit of the rule
                if (PROPERTYEVENTSMAP[property]) {
                    targets[objectId] = targets[objectId] || [];
                    targets[objectId].push(PROPERTYEVENTSMAP[property]);
                }
                switch (objectId) {
                case 'pipeline':
                    return 'pipeline.data.' + property;
                default:
                    return 'pipeline._getTask("' + objectId + '").' + property;
                }
            });

            // cache compiled scripts globally
            businessScripts[rulz] = businessScripts[rulz] || vm.createScript(rulz);

            return {
                targets: targets,
                rule: rulz,
                test: function () {
                    return businessScripts[rulz].runInContext(self._vmContext);
                }
            };
        },

        _addToFlushQueue: function (task) {
            this.data.flushQueue.push(task);
        },

        _getTask: function (config) {
            var task;

            // get by task id
            if (typeof config === 'string' || typeof config === 'number') {
                config = {
                    id: config
                };
                // creat task if one with this id doesn't exist
                task = this.data.tasks[config.id] = this.data.tasks[config.id] || new Task(config, this);
                return task;
            }

            // get by config object - if it doesn't exist just create it
            task = this.data.tasks[config.id];
            if (task) {
                task.initialize(config, this);
            } else {
                task = this.data.tasks[config.id] = this.data.tasks[config.id] || new Task(config, this);
            }

            return task;
        },

        _error: function (task, done) {
            task.errored = true;
            task.rendered = true;
            task.data = '<span>ERROR</span>';
            Y.log('[pipeline.server.js:462] errored:' + task.id, 'info', NAME);
            this.data.events.fire(task.id, 'onError', done);
        },

        _timeout: function (task, done) {
            task.timedOut = true;
            task.rendered = true;
            task.data = '<span>TIMEOUT</span>';
            Y.log('[pipeline.server.js:462] timed out:' + task.id, 'info', NAME);
            this.data.events.fire(task.id, 'onTimeout', done);
        },

        _render: function (task, done) {
            var pipeline = this;

            pipeline.data.events.fire(task.id, 'beforeRender', function () {
                var params,
                    command,
                    children = {},
                    adapter = new Pipeline.Adapter(task, pipeline.adapter, function (data, meta, err) {
                        if (err) {
                            return pipeline._error(task, done);
                        }
                        task.rendered = true;
                        task.data = data;
                        task.meta = meta;

                        Y.log('[pipeline.server.js:481] rendered:' + task.id, 'info', NAME);
                        pipeline.data.events.fire(task.id, 'afterRender', function () {
                            if (done) {
                                done(data, meta);
                            }
                        }, data, meta);
                    });

                // copy any params specified by task config
                // add a children object to the body attribute of params
                params = task.params ? Y.clone(task.params) : {};
                params.body = params.body || {};
                params.body.children = params.body.children || {};

                // get all children tasks and sections
                // and add to the params' body
                Y.mix(children, task.childrenTasks);
                Y.mix(children, task.childrenSections);
                Y.Object.each(children, function (childTask) {
                    var embeddable = childTask.isEmbeddable(),
                        markup = childTask.getMarkup(embeddable);

                    if (childTask.group) {
                        params.body.children[childTask.group] = params.body.children[childTask.group] || [];
                        params.body.children[childTask.group].push(markup);
                    } else {
                        params.body.children[childTask.id] = markup;
                    }

                    childTask.embedded = embeddable && childTask.rendered;
                    if (childTask.embedded) {
                        if (childTask.flushSubscription) {
                            childTask.flushSubscription.unsubscribe(); // parent will flush this child
                        }
                        task.embeddedChildren.push(childTask);
                    }
                });

                command = {
                    instance: task,
                    action: task.action || 'index',
                    context: pipeline.command.context,
                    params: params
                };

                pipeline.ac._dispatch(command, adapter);
            }, task);
        },

        // keep track of the number of processed tasks in this batch and flush it if we're done
        _taskProcessed: function (task) {
            var pipeline = this;
            this.data.numUnprocessedTasks--;
            if (this.data.numUnprocessedTasks > 0) {
                return;
            }

            if (this.data.closed) {
                Y.log('[pipeline.server.js:545] onClose: pipeline', 'info', NAME);
                this.data.events.fire('pipeline', 'onClose', function () {
                    if (pipeline.data.flushQueue.length === 0) {
                        return pipeline.__flushQueuedTasks('', {});
                    }
                    pipeline._flushQueuedTasks();
                });
            } else {
                this._flushQueuedTasks();
            }
        },

        // wrap each task, fire its flush event and flush everything when all are done
        _flushQueuedTasks: function () {
            var pipeline = this,
                i,
                j,
                flushStr = "",
                flushMeta = {},
                task,
                processedTasks = 0,
                flushAndFire = function () {
                    if (++processedTasks === pipeline.data.flushQueue.length) {
                        pipeline.__flushQueuedTasks(flushStr, flushMeta);
                    }
                    task.flushed = true;
                    Y.log('[pipeline.server.js:569] afterFlush:' + task.id, 'info', NAME);
                    pipeline.data.events.fire(task.id, 'afterFlush');
                };

            // if the pipeline is closed but there is no data pipeline still has to flush the closing tags
            if (this.data.closed && this.data.flushQueue.length === 0) {
                pipeline.__flushQueuedTasks(flushStr, flushMeta);
            }

            for (i = 0; i < this.data.flushQueue.length; i++) {
                task = this.data.flushQueue[i];

                // add embedded children to flushQueue such that their flush events are called
                for (j = 0; j < task.embeddedChildren.length; j++) {
                    this.data.flushQueue.push(task.embeddedChildren[j]);
                }

                // do not flush embedded children
                if (!task.embedded) {
                    flushStr += task.wrap();
                    Y.mojito.util.metaMerge(flushMeta, task.meta);
                }

                this.data.events.fire(task.id, 'beforeFlush', flushAndFire);
            }
        },

        // flush the wrapped tasks within a <script> tag, fire pipeline flush
        __flushQueuedTasks: function (flushStr, flushMeta) {
            var pipeline = this,
                flushData = {
                    data: flushStr ? '<script>' + flushStr + '</script>' : '',
                    meta: flushMeta
                };

            Y.log('[pipeline.server.js:604] afterFlush: pipeline', 'info', NAME);
            this.data.events.fire('pipeline', 'afterFlush', function () {
                if (pipeline.data.closed) {
                    pipeline.ac.done(flushData.data + '</body></html>', flushData.meta);
                } else {
                    pipeline.ac.flush(flushData.data, flushData.meta);
                }
                pipeline.data.flushQueue = [];
            }, flushData);
        }
    };

    Y.namespace('mojito.addons.ac').pipeline = Pipeline;
}, '0.0.1', {
    requires: [
        'mojito',
        'mojito-utils',
        'base-base',
        'target-action-events'
    ]
});