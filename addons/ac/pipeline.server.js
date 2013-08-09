/*
 * Copyright (c) 2013 Yahoo! Inc. All rights reserved.
 */

/*jslint nomen: true, plusplus: true, forin: true */
/*globals escape */
YUI.add('mojito-pipeline-addon', function (Y, NAME) {
    'use strict';

    /**
     * The main task processor - takes care of the lifecycle
     * of the tasks
     * @param {Object} command the command from the action context
     * @param {Object} adapter the output adapter for flushing the rendered views
     * @param {ActionContext} ac the action context for the current request
     */

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

        this.client = new Pipeline.Client();

        this.data = {
            closed: false,
            events: new Y.Pipeline.Events(),
            tasks: {},
            numUnprocessedTasks: 0,
            sections: {},
            flushQueue: []
        };
    }

    function Task(task, pipeline) {
        this.initialize(task, pipeline);
    }

    Task.EVENT_TYPES = ['beforeRender', 'afterRender'];

    Task._combineTests = function () {
        return function () {
            return !Y.Array.some(arguments, function (nextFn) {
                return !nextFn.call();
            });
        };
    };

    Task.prototype = {
        initialize: function (task, pipeline) {
            this.renderTargets = {};
            this.flushTargets = {};
            this.displayTargets = {};
            this.childrenTasks = {};
            this.childrenSections = {};

            if (pipeline.data.sections[task.id]) {
                this.isSection = true;
                Y.mix(this, pipeline.data.sections[task.id], true);
            }
            Y.mix(this, task, true);

            var self = this,
                childrenSections;

            Y.Array.each(task.dependencies, function (dependency) {
                // get dependency task
                self.childrenTasks[dependency] = pipeline._getTask(dependency);
                // add dependency to render targets
                self.renderTargets[dependency] = ['afterRender'];
            });

            childrenSections = this.sections;
            Y.Object.each(childrenSections, function (childSection, childSectionId) {
                // get child section task
                self.childrenSections[childSectionId] = pipeline._getTask(childSectionId);
                // add child section to render targets only if js is disabled
                if (!pipeline.client.jsEnabled) {
                    self.renderTargets[childSectionId] = ['afterRender'];
                }
            });

            // if this task has a parent
            // it should include its parent's display action as a display target
            if (this.parent) {
                this.displayTargets[this.parent.id] = ['display'];
            }

            if (!pipeline.client.jsEnabled) {
                // change to the noJS tests
                this.renderTest = this.noJSRenderTest;
                this.flushTest = this.noJSFlushTest;
                // add client to render targets since the noJSRenderTest
                // needs to know about pipeline's closed state
                this.renderTargets.pipeline = ['close'];
            } else {
                // if js is enabled combine tests with grammar
                // TODO how to handle display
                Y.Array.each(['render', 'flush'], function (action) {
                    if (self[action]) {
                        var grammar = pipeline._parseGrammar(self[action]);

                        // replace the test with combined test
                        self[action + 'Test'] = function () {
                            return Task.prototype[action + 'Test'].bind(self).call(pipeline) &&
                                grammar.test(pipeline);
                        };

                        // add the grammar targets
                        self[action + 'Targets'] = Y.Pipeline.Events.mergeTargets(self[action + 'Targets'], grammar.targets);
                    }
                });

                // by default the flush test has one target (the task's render event itself)
                this.flushTargets[this.id] = ['afterRender'];
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

        renderTest: function (pipeline) {
            return !Y.Object.some(this.childrenTasks, function (task) {
                return !task.rendered;
            });
        },

        noJSFlushTest: function (pipeline) {
            return false;
        },

        flushTest: function (pipeline) {
            return this.rendered;
        },

        displayTest: function (pipeline) {
            if (this.parent) {
                return this.parent.displayed;
            }
            return true;
        },

        toString: function () {
            return this.data === undefined && this.isSection ?  '<div id="' + this.id + '-section"></div>' : this.data;
        },

        wrap: function () {
            var wrapped = 'pipeline.push({' +
                'id: "' + this.id + '-section",' +
                'markup: "' + escape(this.toString()) + '"';

            wrapped += ',' +
                'displayTargets: ' + JSON.stringify(this.displayTargets);

            if (this.displayTest) {
                wrapped += ',' +
                    'displayTest: ' + this.displayTest.toString();
            }

            wrapped += '});';

            return wrapped;
        }
    };

    Pipeline.EVENT_TYPES = ['beforeFlush', 'afterFlush'];

    Pipeline.Client = function () {
        this.jsEnabled = true;
    };

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
        }
    };

    Pipeline.prototype = {
        namespace: 'pipeline',

        configure: function (config) {
            var pipeline = this,
                getSections = function (sections, parentSection) {
                    if (!sections) {
                        return;
                    }
                    Y.Object.each(sections, function (sectionConfig, sectionName) {
                        pipeline.data.sections[sectionName] = sectionConfig;
                        pipeline.data.sections[sectionName].sectionName = sectionName;
                        pipeline.data.sections[sectionName].parent = parentSection;
                        getSections(sectionConfig.sections, sectionConfig);
                    });
                };

            getSections(config.sections, null);
        },

        on: function (targetAction, action) {
            return this.data.events.subscribe({
                'pipeline': [targetAction]
            }, action);
        },

        close: function () {
            this.data.closedCalled = true;
        },

        push: function (taskConfig) {

            // keep track to know when to flush the batch
            this.data.numUnprocessedTasks++;
            process.nextTick(function () {
                var pipeline = this,
                    renderSubscription,
                    flushSubscription,
                    targets,
                    task = pipeline._getTask(taskConfig);

                task.pushed = true;

                // subscribe to any events specified by the task
                Y.Array.each(Task.EVENT_TYPES, function (targetAction) {
                    if (!task[targetAction]) {
                        return;
                    }
                    var targets = {};
                    targets[task.id] = [targetAction];
                    pipeline.data.events.subscribe(targets, task[targetAction]);
                });

                // push any default sections of this task
                Y.Object.each(task.sections, function (config, sectionId) {
                    config.id = sectionId;
                    if (config['default']) {
                        pipeline.push(config);
                    }
                });

                // TODO: parse the render rules and combine the tests with sectionsRenderTest
                //task.renderTest = Task._combineTests(task.renderTest);
                //task.flushTest = Task._combineTests(task.flushTest);

                // subscribe to flush events
                if (task.isSection) {
                    flushSubscription = this.data.events.subscribe(task.flushTargets, function (event, done) {
                        if (task.flushTest(pipeline)) {
                            // remove subscribed events such that this action doesn't get called again
                            flushSubscription.unsubscribe();
                            pipeline._addToFlushQueue(task);
                        }
                        done();
                    });

                    // if this task has a parent
                    // listen to parent's render in order to remove flush subscription if
                    // this task has been rendered
                    if (task.parent) {
                        targets = {};
                        targets[task.parent.id] = ['render'];
                        this.data.events.once(targets, function (event, done) {
                            if (task.rendered) {
                                flushSubscription.unsubscribe();
                            }
                        });
                    }

                }

                // test task's render condition
                // if true, immediately render the task
                if (task.renderTest(pipeline)) {
                    pipeline._render(task, function (data, meta) {
                        pipeline._taskProcessed(task);
                    });
                    return;
                }

                // if task's render condition fail, subscribe to render events
                renderSubscription = this.data.events.subscribe(task.renderTargets, function (event, done) {
                    if (task.renderTest(pipeline)) {
                        // remove subscribed events such that this action doesn't get called again
                        renderSubscription.unsubscribe();
                        pipeline._render(task, function () {
                            //pipeline._taskProcessed();
                            done();
                        });
                    } else {
                        done();
                    }
                });

                pipeline._taskProcessed(task);

                return;
            }.bind(this));
        },

        _parseGrammar: function (grammar) {
            return {
                targets: {},
                test: function () {
                    return true;
                }
            };
        },

        _addToFlushQueue: function (task) {
            this.data.flushQueue.push(task);
        },

        _getTask: function (config) {
            var task;
            // if getting task by id get task if it exists,
            // if it doesn't exist create a dummy task
            if (typeof config === 'string' || typeof config === 'number') {
                config = {
                    id: config
                };

                task = this.data.tasks[config.id] = this.data.tasks[config.id] || new Task(config, this);
                return task;
            }

            // if getting task with a configuration
            // get task if it exists
            // if it exits then merge the config
            // else just create the task
            task = this.data.tasks[config.id];
            if (task) {
                //Y.mix(task, config, true);
                task.initialize(config, this);
            } else {
                task = this.data.tasks[config.id] = this.data.tasks[config.id] || new Task(config, this);
            }
            return task;
        },

        _render: function (task, done) {
            var pipeline = this;
            pipeline.data.events.fire(task.id, 'beforeRender', function () {
                var params,
                    command,
                    children = {},
                    adapter = new Pipeline.Adapter(task, pipeline.adapter, function (data, meta) {
                        var subscription;
                        task.rendered = true;
                        task.data = data;
                        task.meta = meta;

                        // fire after render event
                        pipeline.data.events.fire(task.id, 'afterRender', function () {
                            done(data, meta);
                        }, data, meta);
                    });

                // create params
                params = {
                    body: {
                        children: {}
                    }
                };

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
                    if (childTask.group) {
                        params.body.children[childTask.group] = params.body.children[childTask.group] || [];
                        params.body.children[childTask.group].push(childTask);
                    } else {
                        params.body.children[childTask.id] = childTask;
                    }
                });
                Y.mix(params.body.children, task.childrenTasks);

                command = {
                    instance: task,
                    action: task.action || 'index',
                    context: pipeline.command.context,
                    params: params
                };

                pipeline.ac._dispatch(command, adapter);
            }, task);
        },

        _taskProcessed: function (task) {
            var pipeline = this;
            this.data.numUnprocessedTasks--;
            if (this.data.numUnprocessedTasks !== 0) {
                return;
            }

            if (this.data.closedCalled) {
                this.data.closed = true;
                this.data.events.fire('pipeline', 'close', function () {
                    pipeline._flushQueuedTasks();
                });
            } else {
                this._flushQueuedTasks();
            }
        },

        _flushQueuedTasks: function () {
            var i,
                flushData = "",
                flushMeta = {},
                task;

            for (i = 0; i < this.data.flushQueue.length; i++) {
                task = this.data.flushQueue[i];
                flushData += task.wrap();
                Y.mojito.util.metaMerge(flushMeta, task.meta);
            }

            if (!flushData) {
                return;
            }

            flushData = '<script>' + flushData + '</script>';

            if (this.data.closed) {
                this.ac.done(flushData + '</body></html>', flushMeta);
            } else {
                this.ac.flush(flushData, flushMeta);
            }
            this.data.flushQueue = [];
        },

        _combineTests: function () {
            return function () {
                return !Y.Array.some(arguments, function (nextFn) {
                    return !nextFn.call();
                });
            };
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