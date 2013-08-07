/*
 * Copyright (c) 2013 Yahoo! Inc. All rights reserved.
 */

/*jslint nomen: true, plusplus: true, forin: true */
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
        this.command = command;
        this.adapter = adapter;
        this.ac = ac;

        this.events = new Y.Pipeline.Events();
        this.tasks = {};
        this.closed = false;
        this.client = new Pipeline.Client();
        this.unprocessedTasks = 0;
        this._flushQueue = [];
    }

    function Task(task, pipeline) {
        this.pipeline = pipeline;

        // TODO: pipeline.sections should not have properties render nor flush
        // these should be converted to targets
        delete task.render;
        delete task.flush;

        if (pipeline.sections[task.id]) {

            delete pipeline.sections[task.id].render;
            delete pipeline.sections[task.id].flush;

            Y.mix(this, pipeline.sections[task.id], true);
        }

        Y.mix(this, task, true);

        // get children tasks
        // and determine render targets
        this.children = {};
        this.renderTargets = {};
        Y.Array.each(task.dependencies, function (dependency) {
            this.children[dependency] = pipeline.getTask(dependency);
            this.renderTargets[dependency] = ['afterRender'];
        });

        // by default the flush test has one target (the task's render event itself)
        this.flushTargets = {};
        this.flushTargets[this.id] = ['afterRender'];
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
        render: function (done) {
            var pipeline = this.pipeline,
                task = this;
            pipeline.events.fire(task.id, 'beforeRender', function () {
                var command = {
                        instance: task,
                        action: task.action || 'index',
                        context: pipeline.command.context,
                        params: task.params || pipeline.command.params
                    },
                    adapter = new Pipeline.Adapter(task, pipeline.adapter, function (data, meta) {
                        var subscription;
                        task.data = data;
                        task.meta = meta;

                        // fire after render event
                        pipeline.events.fire(task.id, 'afterRender', function () {
                            done(data, meta);
                        }, data, meta);
                    });

                pipeline.ac._dispatch(command, adapter);
            }, task);
        },

        addToFlushQueue: function () {
            this.pipeline._flushQueue.push(this);
        },

        renderTest: function () {
            return !Y.Object.some(this.children, function (task) {
                return !task.rendered;
            });
        },

        flushTest: function () { return this.rendered; }
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

    Pipeline._flattenSections = function (config) {
        var sectionMap = {},
            depthFirstWalk = function (callback, obj, id) {
                callback(obj, id);
                if (obj instanceof Object) {
                    Y.Object.each(obj, depthFirstWalk.bind(null, callback));
                }
            };
        depthFirstWalk(function (obj, id) {
            if (id === 'sections') {
                Y.Object.each(obj, function (sectionConfig, sectionId) {
                    sectionMap[sectionId] = sectionConfig;
                });
            }
        }, config, '');
        return sectionMap;
    };

    Pipeline.prototype = {
        namespace: 'pipeline',

        configure: function (config) {
            this.sections = {};

            var pipeline = this,
                getSections = function (sections) {
                    if (!sections) {
                        return;
                    }
                    Y.Object.each(sections, function (sectionConfig, sectionName) {
                        pipeline.sections[sectionName] = sectionConfig;
                        getSections(sectionConfig.sections);
                    });
                };

            getSections(config.sections);
        },

        on: function (targetAction, action) {
            this.events({
                'pipeline': [targetAction]
            }, action);
        },

        close: function () {
            var pipeline = this;
            // this method should be async in order to make sure
            // any pushed tasks get processed first
            process.nextTick(function () {
                pipeline.closed = true;
                pipeline.flushQueue();
            });
        },

        flushQueue: function () {
            var i,
                flushData = "",
                flushMeta = {},
                task;

            for (i = 0; i < this._flushQueue.length; i++) {
                task = this._flushQueue[i];
                flushData += task.data;
                Y.mojito.util.metaMerge(flushMeta, task.meta);
            }
            if (!flushData) {
                return;
            }
            if (this.closed) {
                this.ac.done(flushData + '</html>', flushMeta);
            } else {
                this.ac.flush(flushData, flushMeta);
            }
        },

        getTask: function (config) {
            var task;
            // if getting task by id get task if it exists,
            // if it doesn't exist create a dummy task
            if (typeof config === 'string' || typeof config === 'number') {
                config = {
                    id: config
                };
                task = this.tasks[config] = new Task(config, this);
                return task;
            }

            // if getting task with a configuration
            // get task if it exists
            // if it exits then merge the config
            // else just create the task
            task = this.tasks[config.id];
            if (task) {
                Y.mix(task, config, true);
            } else {
                task = this.tasks[config.id] = new Task(config, this);
            }
            return task;
        },

        push: function (taskConfig) {
            var pipeline = this,
                renderSubscription,
                flushSubscription,
                task = pipeline.getTask(taskConfig);

            task.pushed = true;

            Y.mix(task, taskConfig, true);

            // keep track to know when to flush the batch
            this.unprocessedTasks++;

            // subscribe to any events specified by the task
            Y.Array.each(Task.EVENT_TYPES, function (targetAction) {
                if (!task[targetAction]) {
                    return;
                }
                var targets = {};
                targets[task.id] = [targetAction];
                pipeline.events.subscribe(targets, task[targetAction]);
            });

            // for each section in the config
            Y.Object.each(task.sections, function (config, sectionId) {
                config.id = sectionId;
                // push the default sections if they're not already there
                if (config['default']) {
                    pipeline.push(config);
                }
            });

            // TODO: parse the render rules and combine the tests with sectionsRenderTest
            //task.renderTest = Task._combineTests(task.renderTest);
            //task.flushTest = Task._combineTests(task.flushTest);

            // subscribe to flush events
            flushSubscription = this.events.subscribe(task.flushTargets, function (event, done) {
                if (task.flushTest()) {
                    // remove subscribed events such that this action doesn't get called again
                    flushSubscription.unsubscribe();
                    task.addToFlushQueue();
                }
                done();
            });

            if (task.renderTest()) {
                task.render(function (data, meta) {
                    if (--pipeline.unprocessedTasks === 0) {
                        // if so, empty the queue
                        pipeline.flushQueue();
                    }
                });
                return;
            }

            renderSubscription = this.events.subscribe(task.renderTargets, function (event, done) {
                if (task.renderTest()) {
                    // remove subscribed events such that this action doesn't get called again
                    renderSubscription.unsubscribe();
                    task.render(function () {
                        done();
                    });
                } else {
                    done();
                }
            });


            if (--pipeline.unprocessedTasks === 0) {
                // if so, empty the queue
                pipeline.flushQueue();
            }

            return;
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