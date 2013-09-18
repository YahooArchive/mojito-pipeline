/*
 * Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

/*jslint node: true, nomen: true, plusplus: true, regexp: true */
/*globals YUI, escape */

YUI.add('mojito-pipeline-addon', function (Y, NAME) {
    'use strict';

    var vm = require('vm'),
        businessScripts = {},
        MojitoActionContext = Y.namespace('mojito').ActionContext,

        PROPERTYEVENTSMAP = {
            'closed'     : 'onClose',
            'dispatched' : 'afterDispatch',
            'rendered'   : 'afterRender',
            'flushed'    : 'afterFlush',
            'displayed'  : 'afterDisplay',
            'errored'    : 'onError',
            'timedOut'   : 'onTimeout'
        },

        TIMEOUT = 50000, //TODO
        NAME_DOT_PROPERTY_REGEX = /([a-zA-Z_$][0-9a-zA-Z_$\-]*)\.([^\s]+)/gm,
        EVENT_TYPES = ['beforeDispatch', 'afterDisptach', 'beforeRender', 'afterRender', 'beforeFlush', 'afterFlush', 'onError', 'onClose', 'onTimeout'],
        ACTIONS = ['dispatch', 'render', 'flush', 'display', 'error'];

    function PipelineActionContext() {
        return MojitoActionContext.apply(this, arguments);
    }

    PipelineActionContext.prototype = {
        flush: MojitoActionContext.prototype.flush,
        done: function () {
            var doneArgs = arguments,
                pipeline = this.command.pipeline,
                task = this.command.task;

            if (!task) {
                return MojitoActionContext.prototype.done.apply(this, doneArgs);
            }
            // TODO
            task.actionContext = this;
            task.doneArgs = doneArgs;
            pipeline._afterDispatch(task, task.dispatchCallback);
        },
        error: MojitoActionContext.prototype.error
    };

    Y.namespace('mojito').ActionContext = PipelineActionContext;

    function Pipeline(command, adapter, ac) {
        this.ac = ac;

        this.anonymousTaskPrefix = 0;

        // the pipeline properties need to be shared across ac instances
        // and adapter.req is a singleton across request
        if (!adapter.req.pipeline) {
            adapter.req.pipeline = this;
        } else {
            return Y.mix(this, adapter.req.pipeline);
        }

        this.command = command;
        this.adapter = adapter;

        // TODO: revisit this storage of shared properties across mojits
        this.data = {
            closed: false,
            events: new Y.Pipeline.Events(),
            tasks: {},
            numUnprocessedTasks: 0,
            sections: {},
            flushQueue: [],
            // the html frame parameters
            params: this.command.params,
            // the html frame action context
            ac: ac,
            frameData: {}
        };
        this._parsedRules = {};
        this._flushQueue = [];
        this._vmContext = vm.createContext({ pipeline: this });
    }

    function Task(task, pipeline) {
        // the states this tasks get along its lifecycle stages
        this.pushed     = false;
        this.dispatched = false;
        this.rendered   = false;
        this.flushed    = false;
        this.errored    = false;
        this.timedOut   = false;

        // the tasks this task observes along its lifecycle stages
        this.dispatchTargets = {};
        this.renderTargets   = {};
        this.errorTargets    = {};
        this.flushTargets    = {};
        this.displayTargets  = {};

        this.dispatchSubscription = null;
        this.renderSubscription   = null;
        this.flushSubscription    = null;
        this.errorSubscription    = null;
        this.timeoutSubscription  = null;
        this.closeSubscription    = null;

        this.dependencyTasks  = {}; // children that should block this task from dispatching
        this.sectionTasks     = {}; // children that can be replaced by an empty <div> stub
        this.childrenTasks    = {}; // all children
        this.embeddedChildren = []; // children that were rendered before this task was rendered

        this.meta = {};

        // merge task config with the config that pipeline has for this task ...
        if (pipeline.data.sections[task.id]) {
            this.isSection = true;
            Y.mix(this, pipeline.data.sections[task.id], true);
        }

        this.initialize(task, pipeline);
    }

    Task.prototype = {

        initialize: function (task, pipeline) {
            var self = this;

            Y.mix(this, task, true); // ... and the config that is given when pushing

            // get all dependency tasks
            // dispatch targets consist of all dependencies since this task should
            // only render after each dependency has rendered
            Y.Array.each(task.dependencies, function (dependency) {
                self.dependencyTasks[dependency] = pipeline._getTask(dependency);
                self.dispatchTargets[dependency] = ['afterRender'];
            }, this);

            // get all section tasks
            // if js is disabled, dispatch targets should consist of all children sections since
            // this task should only render after each section has rendered
            Y.Object.each(this.sections, function (section, sectionId) {
                self.sectionTasks[sectionId] = pipeline._getTask(sectionId);
                if (!pipeline.client.jsEnabled) {
                    self.renderTargets[sectionId] = ['afterRender'];
                }
            }, this);

            Y.mix(this.childrenTasks, this.dependencyTasks);
            Y.mix(this.childrenTasks, this.sectionTasks);
            Y.Object.each(this.childrenTasks, function (childTask) {
                childTask.parent = this;
                // children sections without a specified timeout inherit this' timeout
                childTask.timeout = childTask.timeout === undefined ? this.timeout : childTask.timeout;
            }, this);

            // by default display after the parent section is displayed
            if (this.parentSectionName) {
                this.displayTargets[this.parentSectionName] = ['afterDisplay'];
            }

            if (!pipeline.client.jsEnabled) {
                this.renderTest = this.noJSRenderTest;
                this.flushTest = this.noJSFlushTest;
                // add pipeline to render targets since the noJSRenderTest
                // needs to know about pipeline's closed state
                this.renderTargets.pipeline = ['onClose'];
            }

            // combine default tests with user rules
            Y.Array.each(ACTIONS, function (action) {
                if (self[action]) {
                    var rule = pipeline._getRule(self, action),
                        defaultTest = self[action + 'Test'];

                    // TODO: only replace test is there is a user rule
                    // replace the test with combined test
                    self[action + 'Test'] = function () {
                        return defaultTest.call(self, pipeline) && rule.test();
                    };

                    // add the rule targets
                    self[action + 'Targets'] = Pipeline._mergeEventTargets(self[action + 'Targets'], rule.targets);
                }
            });
        },

        // default renderTest: "no child task is not rendered"
        dispatchTest: function (pipeline) {
            return !Y.Object.some(this.dependencyTasks, function (dependencyTask) {
                return !dependencyTask.rendered;
            });
        },

        renderTest: function (pipeline) {
            return true;
        },

        noJSRenderTest: function (pipeline) {
            if (pipeline.data.closed) {
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

        // default: flush unless this task is embedded
        flushTest: function (pipeline) {
            return !this.embedded;
        },

        // default: when js is disabled only the root should be flush
        noJSFlushTest: function (pipeline) {
            return this.id === 'root';
        },

        // default: "if rule exists, default to true, else default to false"
        errorTest: function () {
            return !!this.error;
        },

        toString: function () {
            if (!this.rendered) {
                return '<div id="' + this.id + '-section"></div>';
            }
            return this.data;
        },

        // wrap markup into a pipeline.push() with other useful info to place the markup in the skeleton
        wrap: function (pipeline) {
            var wrapped = 'pipeline.push({' +
                'markup: "' + escape(this.data) + '"';

            Y.Object.each(this, function (property, propertyName) {
                var embeddedChildren = [];
                switch (propertyName) {
                case 'id':
                    wrapped += ',\n' + propertyName + ': "' + property + '"';
                    break;
                case 'displayTargets':
                case 'embeddedChildren':
                    Y.Array.each(property, function (section, index) {
                        embeddedChildren.push(section.id);
                    });
                    wrapped += ',\n' + propertyName + ": " + JSON.stringify(embeddedChildren);
                    break;
                case 'displayTest':
                    wrapped += ',\n' + propertyName + ': function (pipeline) {' +
                            'return eval(\'' +
                                pipeline._getRule(this, 'display').rule + '\');}';
                    break;
                case 'timedOut':
                case 'errored':
                    wrapped += ',\n' + propertyName + ': ' + property;
                    break;
                default:
                }
            }, this);

            wrapped += '});\n';

            return wrapped;
        }
    };

    Pipeline.Client = function (ac, rs) {
        this.script = rs.pipeline.client;
        this.unminifiedScript = rs.pipeline.unminifiedClient;
        this.jsEnabled = ac.jscheck.status() === 'enabled';
        // TODO: document that pipeline htmlframe can accept a jscheck boolean configuration
        ac.jscheck.run();
    };

    // rendering adapter for mojito
    Pipeline.Adapter = function (task, pipelineAdapter, callback) {
        this.callback = callback;
        this.task = task;
        this.data = '';
        this.meta = task.meta;
        Y.mix(this, pipelineAdapter);
    };

    Pipeline.Adapter.prototype = {

        done: function (data, meta) {
            if (!this.callback) {
                return;
            }
            this.data += data;
            // this trick is to call metaMerge only after the first pass
            this.meta = (this.meta ? Y.mojito.util.metaMerge(this.meta, meta) : meta);
            this.callback(this.data, this.meta, null, this.task);
        },

        flush: function (data, meta) {
            this.data += data;
            // this trick is to call metaMerge only after the first pass
            this.meta = (this.meta ? Y.mojito.util.metaMerge(this.meta, meta) : meta);
        },

        error: function (err) {
            if (this.callback) {
                this.callback(this.data, this.meta, err, this.task);
            }
        }
    };

    Pipeline.prototype = {

        namespace: 'pipeline',

        /**
         * called by mojito at initialization to share the resource store with this ac addon
         * @param {ResourceStore} rs the runtime ResourceStore
         */
        setStore: function (rs) {
            if (!this.client) {
                this.client = new Pipeline.Client(this.ac, rs);
            }
        },

        // TODO: find another way to let children change the template data passed to the htmlframe
        configure: function (config, frameData) {
            config.sectionName = 'root';
            var pipeline = this,
                // walk through the sections config tree and populate the pipeline sections object
                flattenSections = function (sections, parent) {
                    Y.Object.each(sections, function (sectionConfig, sectionName) {
                        var section = pipeline.data.sections[sectionName] = sectionConfig || {};
                        section.sectionName = sectionName;
                        section.parentSectionName = parent && parent.sectionName;
                        flattenSections(section.sections, section);
                    });
                };

            flattenSections(config.sections, undefined);

            this.data.frameData = frameData || this.data.frameData;
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
            return this.data.events.subscribe(targets, action);
        },

        close: function () {
            this.data.closeCalled = true;
            this._flushIfReady();
        },

        push: function (taskConfig) {
            var task = this._getTask(taskConfig);

            // keep track to know when to flush the batch
            this.data.numUnprocessedTasks++;
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
                pipeline.data.events.subscribe(targets, task[targetAction]);
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
            task.errorSubscription = this.data.events.subscribe(task.errorTargets, function (events, done) {
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

            task.dispatchSubscription = this.data.events.subscribe(task.dispatchTargets, function (event, done) {
                if (task.dispatchTest(pipeline)) {
                    // remove subscribed events such that this action doesn't get called again
                    task.dispatchSubscription.unsubscribe();
                    pipeline._dispatch(task, done);
                } else {
                    done();
                }
            });

            // trigger dispatch after the timeout if timeout exists
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
            task.params = task.params || Y.clone(pipeline.data.params);
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

            pipeline.data.events.fire(task.id, 'beforeDispatch', function () {
                var command,
                    children = {},
                    adapter = new Pipeline.Adapter(task, pipeline.adapter, function (data, meta, error) {
                        // make sure that this callback is not called multiple times
                        delete adapter.callback;

                        task.data = data;
                        task.meta = meta;

                        if (error) {
                            return pipeline._error(task, 'Error after dispatching.', task.renderCallback || task.dispatchCallback);
                        }

                        pipeline._afterRender(task, task.renderCallback);
                    });

                // TODO: change 'onParam' to 'beforeRender' and move all parameter setting before firing the 'beforeRender' event
                command = {
                    instance: {
                        base: task.base,
                        type: task.type,
                        action: task.action,
                        config: task.config
                    },
                    context: pipeline.command.context,
                    params: task.params,
                    pipeline: pipeline,
                    task: task
                };

                // TODO: wrapping dispatch method with perf events for instrumentation purposes
                pipeline.data.events.fire(task.id, 'perfRenderStart', null, task);
                // TODO
                task.dispatchCallback = callback;
                pipeline.ac._dispatch(command, adapter);
                pipeline.data.events.fire(task.id, 'perfRenderEnd', null, task);
            }, task);
        },

        _afterDispatch: function (task, callback) {
            var pipeline = this;
            task.dispatched = true;
            task.timeoutSubscription = clearTimeout(task.timeoutSubscription);
            this.data.events.fire(task.id, 'afterDispatch', function () {
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
            task.renderSubscription = this.data.events.subscribe(task.renderTargets, function (event, done) {
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
                        var index = pipeline.data.flushQueue.indexOf(childTask);
                        if (index !== -1) {
                            pipeline.data.flushQueue.splice(index, 1);
                        }
                        // make sure the flushSubscription is unsubscribed
                        // because it will get flushed automatically with the parent
                        return childTask.flushSubscription && childTask.flushSubscription.unsubscribe();
                    }
                }
            });
            MojitoActionContext.prototype.done.apply(task.actionContext, task.doneArgs);
        },

        _afterRender: function (task, callback) {
            var pipeline = this;
            task.rendered = true;

            pipeline.data.events.fire(task.id, 'afterRender', function () {
                if (task.errored) {
                    return callback && callback();
                }
                pipeline._prepareToFlush(task, callback);
            }, task);
        },

        _prepareToFlush: function (task, callback) {
            var pipeline = this;
            if (!task.isSection) {
                return callback && callback();
            }

            if (task.flushTest(pipeline)) {
                return pipeline._addToFlushQueue(task, callback);
            }

            // subscribe to flush events
            task.flushSubscription = pipeline.data.events.subscribe(task.flushTargets, function (event, done) {
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
            this.data.flushQueue.push(task);
            return callback && callback();
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

        // TODO: make public
        _getTask: function (config) {
            var task;

            // get by task id
            if (typeof config === 'string' || typeof config === 'number') {
                config = {
                    id: config
                };
                // create task if one with this id doesn't exist
                task = this.data.tasks[config.id] = this.data.tasks[config.id] || new Task(config, this);
                return task;
            }

            if (config.id === undefined) {
                config.id = 'autoId' + this.anonymousTaskPrefix++ + '@' + (config.type || config.base);
            }

            // get by config object - if it doesn't exist just create it
            task = this.data.tasks[config.id];
            if (task) {
                task.initialize(config, this);
            } else {
                task = this.data.tasks[config.id] = new Task(config, this);
            }

            return task;
        },

        _error: function (task, error, callback) {
            var pipeline = this;

            Y.log(task.id + ' had an error: ' + error, 'error');
            task.errored = true;
            task.data = '<span>ERROR</span>';

            this.data.events.fire(task.id, 'onError', function () {
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
                    pipeline.data.events.fire(task.id, 'afterRender', function () {
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
            this.data.events.fire(task.id, 'onTimeout', done, task, message);
        },

        // keep track of the number of processed tasks in this batch and flush it if we're done
        _taskProcessed: function (task) {
            this.data.numUnprocessedTasks--;
            this._flushIfReady();
        },

        _flushIfReady: function () {
            var pipeline = this;
            if (this.data.numUnprocessedTasks > 0) {
                return;
            }

            if (this.data.closeCalled) {
                this.data.closed = true;
                this.data.events.fire('pipeline', 'onClose', function () {
                    pipeline._flushQueuedTasks(function () {
                        // report any task that hasnt been flushed
                        Y.Object.each(pipeline.data.tasks, function (task) {
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
                    pipeline.data.events.fire(task.id, 'beforeFlush', function () {
                        task.flushed = true;

                        // remove any error subscription
                        if (task.errorSubscription) {
                            task.errorSubscription.unsubscribe();
                        }

                        // TODO should we remove firing of events that are useless?
                        pipeline.data.events.fire(task.id, 'afterFlush', null, task);

                        if (task.embedded) {
                            return;
                        }

                        if (task.id === 'root') {
                            rootData.data = task.data;
                            rootData.meta = task.meta;
                        } else {
                            flushData.data += task.wrap(pipeline);
                            Y.mojito.util.metaMerge(flushData.meta, task.meta);
                        }

                        ++numFlushedTasks;

                        if (numFlushedTasks === pipeline.data.flushQueue.length) {
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
            if (this.data.closed && this.data.flushQueue.length === 0) {
                pipeline.__flushQueuedTasks(rootData, flushData);
                return done && done();
            }

            for (i = 0; i < this.data.flushQueue.length; i++) {
                task = this.data.flushQueue[i];
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
            this.data.events.fire('pipeline', 'afterFlush', function () {
                if (pipeline.data.closed) {
                    pipeline.data.ac.done('<!-- Flush Start -->\n' + rootData.data + flushData.data + '</body></html>' + '\n<!-- Flush End -->\n\n', flushData.meta);
                } else {
                    pipeline.data.ac.flush('<!-- Flush Start -->\n' + rootData.data + flushData.data + '\n<!-- Flush End -->\n\n', flushData.meta);
                }
                pipeline.data.flushQueue = [];
            }, flushData);
        }
    };

    Pipeline._mergeEventTargets = function () {
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
    };

    Y.namespace('mojito.addons.ac').pipeline = Pipeline;

}, '0.0.1', {
    requires: [
        'base-base',
        'target-action-events',
        'mojito',
        'mojito-action-context',
        'mojito-params-addon',
        'mojito-util',
        'mojito-jscheck-addon'
    ]
});