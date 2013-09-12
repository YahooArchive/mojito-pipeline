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

        PROPERTYEVENTSMAP = {
            'closed'   : 'onClose',
            'rendered' : 'afterRender',
            'flushed'  : 'afterFlush',
            'displayed': 'afterDisplay',
            'errored'  : 'onError',
            'timedOut' : 'onTimeout'
        },

        TIMEOUT = 5000,
        NAME_DOT_PROPERTY_REGEX = /([a-zA-Z_$][0-9a-zA-Z_$\-]*)\.([^\s]+)/gm,
        EVENT_TYPES = ['beforeRender', 'afterRender', 'beforeFlush', 'afterFlush', 'onError', 'onClose', 'onTimeout', 'onParam'],
        ACTIONS = ['render', 'flush', 'display', 'error'];

    function Pipeline(command, adapter, ac) {
        this.ac = ac;

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
            params: ac.params.all(),
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

        this.renderSubscription  = null;
        this.errorSubscription   = null;
        this.flushSubscription   = null;
        this.timeoutSubscription = null;
        this.closeSubscription   = null;

        this.childrenTasks    = {}; // children that should block the task rendering
        this.childrenSections = {}; // children that can be replaced by an empty <div> stub
        this.embeddedChildren = []; // children that had their markup ready and did not need an empty <div> stub

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

            // render after all dependencies (blocking)
            Y.Array.each(task.dependencies, function (dependency) {
                var child = self.childrenTasks[dependency] = pipeline._getTask(dependency);
                child.parent = this;
                // if unspecified, set timeouts to that of parent
                child.timeout = child.timeout === undefined ? this.timeout : child.timeout;
                self.renderTargets[dependency] = ['afterRender'];
            }, this);

            // render after all sections iff js is not enabled on the client
            Y.Object.each(this.sections, function (childSection, childSectionId) {
                var child = self.childrenSections[childSectionId] = pipeline._getTask(childSectionId);
                self.childrenSections[childSectionId].parent = this;
                // if unspecified, set timeouts to that of parent
                child.timeout = child.timeout === undefined ? this.timeout : child.timeout;
                if (!pipeline.client.jsEnabled) {
                    self.renderTargets[childSectionId] = ['afterRender'];
                }
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
            } else {
                // by default flush when this task renders or errors out
                this.flushTargets[this.id] = ['afterRender'];

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
                        self[action + 'Targets'] = Pipeline._mergeEventTargets(self[action + 'Targets'], rule.targets);
                    }
                });
            }

            // if task is child of the html frame
            if (this.id === 'root') {
                // renderTest should return true if js is disabled
                // TODO: why do we have to frce immetiate execution of the root in the noJS case?
                this.renderTest = pipeline.client.jsEnabled ? this.renderTest : function () { return true; };
                // flush test should always be false
                this.flushTest = function () { return false; };
            }
        },

        noJSRenderTest: function (pipeline) {
            // test original renderTest which checks for children dependencies
            if (!Task.prototype.renderTest.call(this)) {
                return false;
            }

            if (pipeline.data.closed) {
                // if pipeline is closed return false if any child section has been pushed but not rendered
                return !Y.Object.some(this.childrenSections, function (childSection, childSectionId) {
                    var childSectionTask = pipeline._getTask(childSectionId);
                    return !childSectionTask.rendered && childSectionTask.pushed;
                });
            }

            // if pipeline is still open, return false if any child section has not been rendered
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

            wrapped += '});';

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
            this.callback(this.data, this.meta);
        },

        flush: function (data, meta) {
            this.data += data;
            // this trick is to call metaMerge only after the first pass
            this.meta = (this.meta ? Y.mojito.util.metaMerge(this.meta, meta) : meta);
        },

        error: function (err) {
            if (this.callback) {
                this.callback(this.data, this.meta, err);
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

        // this method should be called by the root mojit
        // it either takes a single argument, a callback function
        // or two arguments, data and meta
        // if js is enabled then the callback is called immediately
        // otherwise it is called after all other tasks have been processed
        // TODO: make the closing process more streamlined
        done: function (data, meta) {
            var callback = Y.Lang.isFunction(data) ? data : function () {
                this.ac.done(data, meta);
            }.bind(this);

            if (this.client.jsEnabled) {
                return callback();
            }
            this.data.rootDone = callback;
        },

        push: function (taskConfig) {
            // keep track to know when to flush the batch
            this.data.numUnprocessedTasks++;

            // TODO: status of the asynchronicity of adapter rendering?
            process.nextTick(function () {
                this._push(taskConfig);
            }.bind(this));
        },

        _push: function (taskConfig) {
            var pipeline = this,
                task = pipeline._getTask(taskConfig);

            task.pushed = true;

            // set timeouts if not specified
            task.timeout = task.timeout === undefined ? TIMEOUT : task.timeout;

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
                return pipeline._error(task, 'Error condition returned true.', function () {
                    pipeline._taskProcessed(task);
                });
            }

            // else subscribe to error events
            task.errorSubscription = this.data.events.subscribe(task.errorTargets, function (events, done) {
                if (task.errorTest()) {
                    task.errorSubscription.unsubscribe();
                    pipeline._error(task, 'Error condition returned true.');
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
            task.renderSubscription = this.data.events.subscribe(task.renderTargets, function (event, done) {
                if (task.renderTest(pipeline)) {
                    // remove subscribed events such that this action doesn't get called again
                    task.renderSubscription.unsubscribe();
                    pipeline._render(task, done);
                } else {
                    done();
                }
            });

            // trigger rendering after the timeout if timeout exists
            if (task.timeout) {

                // handles the case when a timeout has been reached
                task.timeoutSubscription = setTimeout(function () {

                    task.closeSubscription.unsubscribe();
                    task.renderSubscription.unsubscribe();
                    // fire timeout and then render
                    pipeline._timeout(task, 'data still missing after ' + task.timeout + 'ms.', function () {
                        // In case a task has a timeout that is triggered after pipeline closing,
                        // we want to block the closing untill all renderings are finished. The events module
                        // resumes the closing after ALL the onCloseDone of the subscribers have been called;
                        var onCloseDone,
                            renderFinished = false;
                        pipeline.on('onClose', function (event, done) {
                            if (renderFinished) {
                                done();
                            } else {
                                onCloseDone = done;
                            }
                        });
                        pipeline._render(task, function () {
                            if (onCloseDone) {
                                onCloseDone();
                            }
                            renderFinished = true;
                        });
                    });
                }, task.timeout);

                // handles the case where the pipeline is closed but a task still has missing dependencies
                // and so, even though the timeout hasn't been reached yet, it is imminent
                task.closeSubscription = this.on('onClose', function (event, done) {

                    if (!task.timeoutSubscription) {
                        return done();
                    }
                    task.renderSubscription.unsubscribe();
                    clearTimeout(task.timeoutSubscription);
                    pipeline._timeout(task, 'data still missing after pipeline closed.', function () {
                        pipeline._render(task, function () {
                            done();
                        });
                    });
                });
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

            // get by config object - if it doesn't exist just create it
            task = this.data.tasks[config.id];
            if (task) {
                task.initialize(config, this);
            } else {
                task = this.data.tasks[config.id] = new Task(config, this);
            }

            return task;
        },

        _error: function (task, error, done) {
            var pipeline = this;

            Y.log(task.id + ' had an error: ' + error, 'error');
            task.errored = true;
            this.data.events.fire(task.id, 'onError', function () {
                var errorTask = task.errorContent;
                // if there is no fallback, actificially render the task to ''
                if (!errorTask) {
                    task.data = '';
                    task.rendered = true;
                    pipeline.data.events.fire(task.id, 'afterRender', function () {
                        if (done) {
                            done(task.data, task.meta);
                        }
                    }, task);
                } else {
                    // else replace the original task with an error task in the pipeline
                    errorTask.id      = task.id;
                    errorTask.pushed  = true;
                    errorTask.errored = true;
                    // clear to have _getTask reconstruct a task
                    pipeline.data.tasks[task.id] = undefined;
                    // and try to redispatch
                    pipeline._dispatch(pipeline._getTask(errorTask), done);
                }
            }, task, error);
        },

        _timeout: function (task, message, done) {
            Y.log(task.id + ' timedout: ' + message, 'error');
            task.timedOut = true;
            task.data = '<span>TIMEOUT</span>';
            this.data.events.fire(task.id, 'onTimeout', done, task, message);
        },

        _render: function (task, done) {
            // if there is a timeout, clear it
            task.timeoutSubscription = clearTimeout(task.timeoutSubscription);

            var pipeline = this;

            pipeline.data.events.fire(task.id, 'beforeRender', function () {
                var children = {};

                // copy any params specified by task config
                // add a children object to the body attribute of params
                // TODO is it necessary to get parameters from frame?
                task.params = task.params || Y.clone(pipeline.data.params);
                task.params.body = task.params.body || {};
                task.params.body.children = task.params.body.children || {};

                // get all children tasks and sections
                // and add to the params' body
                Y.mix(children, task.childrenTasks);
                Y.mix(children, task.childrenSections);

                Y.Object.each(children, function (childTask) {
                    if (!task.setParams) {
                        if (childTask.group) {
                            task.params.body.children[childTask.group] = task.params.body.children[childTask.group] || [];
                            task.params.body.children[childTask.group].push(childTask);
                        } else {
                            task.params.body.children[childTask.id] = childTask;
                        }
                    }

                    if (childTask.rendered) {
                        childTask.embedded = true;
                        task.embeddedChildren.push(childTask);
                        // if this embedded child is in the flush queue, remove it
                        var index = pipeline.data.flushQueue.indexOf(childTask);
                        if (index !== -1) {
                            pipeline.data.flushQueue.splice(index, 1);
                        }
                        // include child's meta in parent since it is now embedded
                        task.meta = Y.mojito.util.metaMerge(task.meta, childTask.meta);
                        if (childTask.flushSubscription) {
                            childTask.flushSubscription.unsubscribe(); // parent will flush this child
                        }
                    }
                });

                // TODO: change 'onParam' to 'beforeRender' and move all parameter setting before firing the 'beforeRender' event
                pipeline.data.events.fire(task.id, 'onParam', pipeline._dispatch.bind(pipeline, task, done), task, children);

            }, task);
        },

        _dispatch: function (task, done) {
            var pipeline = this,
                command = {
                    instance: {
                        base: task.base,
                        type: task.type,
                        action: task.action,
                        config: task.config
                    },
                    context: pipeline.command.context,
                    params: task.params
                },
                afterRender = function () {
                    pipeline.data.events.fire(task.id, 'afterRender', function () {
                        if (done) {
                            done(task.data, task.meta);
                        }
                    }, task);
                },
                adapter = new Pipeline.Adapter(task, pipeline.adapter, function (data, meta, error, timeout) {
                    // make sure that this callback is not called multiple times
                    delete adapter.callback;

                    task.timeoutSubscription = clearTimeout(task.timeoutSubscription);
                    task.rendered = true;
                    task.data = data;
                    task.meta = meta;

                    if (error) {
                        return pipeline._error(task, error, done);
                    }

                    if (timeout) {
                        pipeline._timeout(task, 'rendering took more than ' + task.renderTimeout + 'ms to complete.', afterRender);
                    } else {
                        afterRender();
                    }
                });

            // TODO: wrapping dispatch method with perf events for instrumentation purposes
            pipeline.data.events.fire(task.id, 'perfRenderStart', null, task);
            // TODO: follow up with the asynchronicity of dispatch
            pipeline.ac._dispatch(command, adapter);
            pipeline.data.events.fire(task.id, 'perfRenderEnd', null, task);

        },

        // keep track of the number of processed tasks in this batch and flush it if we're done
        _taskProcessed: function (task) {
            this.data.numUnprocessedTasks--;
            this._flushIfReady();
        },

        _flushIfReady: function () {
            var pipeline = this;
            if (!this.client.jsEnabled && this.data.closeCalled && this.data.numUnprocessedTasks === 1) {
                return this._processRoot();
            }

            if (this.data.numUnprocessedTasks > 0) {
                return;
            }

            if (this.data.closeCalled) {
                this.data.closed = true;
                this.data.events.fire('pipeline', 'onClose', function () {
                    pipeline._flushQueuedTasks();
                    // report any task that hasnt been flushed
                    Y.Object.each(pipeline.data.tasks, function (task) {
                        if (!task.flushed && task.id !== 'root' && task.pushed) {
                            Y.log(task.id + '(' + task.type + ') remained unflushed.', 'error');
                        }
                    });
                });
            } else {
                this._flushQueuedTasks();
            }
        },

        _processRoot: function () {
            var root = this._getTask('root');
            if (root && this.data.rootDone) {
                Y.Object.each(root.childrenSections, function (child) {
                    root.meta = Y.mojito.util.metaMerge(root.meta, child.meta);
                });
                this.data.rootDone();
            }
        },

        // wrap each task, fire its flush event and flush everything when all are done
        _flushQueuedTasks: function () {
            var pipeline = this,
                i,
                flushStr = '',
                flushMeta = {},
                task,
                numflushedTasks = 0,
                flush = function (task) {
                    pipeline.data.events.fire(task.id, 'beforeFlush', function () {
                        task.flushed = true;
                        if (numflushedTasks === pipeline.data.flushQueue.length) {
                            pipeline.__flushQueuedTasks(flushStr, flushMeta);
                        }
                        pipeline.data.events.fire(task.id, 'afterFlush');
                    });
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
                pipeline.__flushQueuedTasks(flushStr, flushMeta);
            }

            for (i = 0; i < this.data.flushQueue.length; i++) {
                task = this.data.flushQueue[i];

                flushStr += task.wrap(pipeline);

                Y.mojito.util.metaMerge(flushMeta, task.meta);

                ++numflushedTasks;
                flush(task);

                // flush any embedded decendents
                flushEmbeddedDescendants(task, flush);
            }
        },

        // flush the wrapped tasks within a <script> tag, fire pipeline flush
        __flushQueuedTasks: function (flushStr, flushMeta) {
            var pipeline = this,
                flushData = {
                    data: flushStr ? '<script>' + flushStr + '</script>' : '',
                    meta: flushMeta
                };

            this.data.events.fire('pipeline', 'afterFlush', function () {
                flushData.data = '<!-- Flush Start -->\n' + flushData.data + '\n<!-- Flush End -->\n\n';
                if (pipeline.data.closed) {
                    pipeline.data.ac.done(flushData.data + '</body></html>', flushData.meta);
                } else {
                    pipeline.data.ac.flush(flushData.data, flushData.meta);
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
        'mojito-params-addon',
        'mojito-util',
        'mojito-jscheck-addon'
    ]
});