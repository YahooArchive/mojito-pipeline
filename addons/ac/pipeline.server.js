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

    function Task(task) {
        Y.mix(this, task, true);
        //Task.superclass.constructor.apply(this, arguments);
    }
    function Pipeline(command, adapter, ac) {

        /*Pipeline.superclass.constructor.apply(this, {
            command: command,
            adapter: adapter,
            ac: ac
        });*/

        this.command = command;
        this.adapter = adapter;
        this.ac = ac;

        this.events = new Y.Pipeline.Events();
        this.tasks = {};
        this.closed = false;
        this.client = new Pipeline.Client();
        this.numPushedTasks = 0;
        this._flushQueue = [];
        Task.prototype.pipeline = this;
    }

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
            this.sectionMap = Pipeline._flattenSections(config);
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

        render: function (task, done) {
            var pipeline = this;
            this.events.fire(task.id, 'beforeRender', function () {
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

            // TODO: create action context
            // TODO: execute mojit
            // TODO: execute any actions subscribe to this task's render event
            // TODO: test flush condition, if true put in flush queue, else subscribe to events

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

        getTask: function (id) {
            this.tasks[id] = this.tasks[id] || new Task(this.sectionMap[id]);
            return this.task[id];
        },

        push: function (taskConfig) {
            var pipeline = this,
                renderRuleTargets = {},
                flushRuleTargets = {},
                task = pipeline.getTask(taskConfig.id);

            Y.mix(task, taskConfig, true);

            // keep track to know when to flush the batch
            this.unrenderedTasks++;

            // for each section in the config
            Y.Object.each(task.sections, function (config, sectionId) {

                // push the default sections if they're not already there
                if (config['default']) {
                    this.push(taskConfig);
                }
                // build the targets for the render rule of the task
                renderRuleTargets[taskConfig.id] = ['render'];
            }, this);

            // TODO: parse the render rules and combine the tests with sectionsRenderTest
            task.renderTest = Task._combineTests(task.renderTest/* here */);

            // subscribe to the events triggering the render action under some condition
            this.attachAction('render', renderRuleTargets, task.renderTest, function (data, meta) {
                this.attachAction('addToFlushQueue', flushRuleTargets, task.flushTest);

                pipeline.unrenderedTasks--;
                if (pipeline.unrenderedTasks === 0) {
                    // if so, empty the queue
                    pipeline.flushQueue();
                }
            });

            return;
            var pipeline = this,
                i,
                targets,
                targetAction;

            // increment number of pushed tasks
            // once all the pushed tasks have been handled, we need to flush anything in the flush queue
            this.numPushedTasks++;

            // subscribe to any events specified by the task
            for (i = 0; i < Pipeline.prototype.Task.EVENT_TYPES.length; i++) {
                targetAction = Pipeline.prototype.Task.EVENT_TYPES[i];
                if (!task[targetAction]) {
                    continue;
                }
                targets = {};
                targets[task.id] = [targetAction];
                this.events.subscribe(targets, task[targetAction]);
            }

            // TODO: create tasks for any default child section of this task

            // release control in order to make this method asynchronous
            process.nextTick(function () {

                var child,
                    originalTest = task.renderTest,
                    childrenTest,
                    eventTargets = {},
                    subscription;

                // TODO: get the event targets for the original renderTest
                // this is important in order to subscribe to events if necessary
                /*
                    ex.
                    eventTargets = this.rules[task.section].targets
                 */

                // if task has children then create a combination of the renderTest
                if (task.children) {
                    // checks if all the children have been rendered
                    childrenTest = function () {
                        var child;
                        for (child in task.children) {
                            if (!pipeline.getTask(child).rendered) {
                                return false;
                            }
                        }
                        return true;
                    };

                    // subscribe to the events
                    for (child in task.children) {
                        eventTargets[child] = ['afterRender'];
                    }

                    // replace task's renderTest method with the combined childrenTest
                    // and the original renderTest
                    task.renderTest = function () {
                        return originalTest() && childrenTest();
                    };
                }

                // test render condition
                if (task.renderTest()) {
                    pipeline.render(task, function () {
                        pipeline.ac.done();
                        if (--pipeline.numPushedTasks === 0) {
                            pipeline.flushQueue();
                        }
                    });
                    return;
                }

                // render condition is false so now need to subscribe to events

                // it is important that any subscription for the sakes of rendering or flushing
                // should be done only once per task/action otherwise a task may have multiple subscribed events
                // trying to render or flush for the same target action
                subscription = this.events.subscribe(eventTargets, function (event) {
                    if (task.renderTest()) {
                        // remove subscribed events such that this action doesn't get called again
                        subscription.unsubscribe();
                        pipeline.render(task);
                    }
                });

                if (--this.numPushedTasks === 0) {
                    this.flushQueue();
                }
            });
        }
    };

    Task.EVENT_TYPES = ['beforeRender', 'afterRender'];

    Task._combineTests = function () {
        return function () {
            return !Y.Array.some(arguments, function (nextFn) {
                return !nextFn.call();
            });
        };
    };

    Task.prototype = {
        render: function (task, done) {
            var pipeline = this;
            this.events.fire(task.id, 'beforeRender', function () {
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

        attachAction: function (action, targets, testFn, afterAction) {
            var subscription;
            afterAction = afterAction || function () {};

            if (testFn()) {
                this[action].call(this, afterAction);
            } else {
                subscription = this.pipeline.events.subscribe(targets, function (e, done) {
                    if (testFn()) {
                        subscription.unsubscribe();
                        this[action].call(this, function () {
                            afterAction();
                            done();
                        });
                    }
                });
            }
        },

        renderTest: function () {
            return !Y.Object.some(this.children, function (task) {
                return !task.rendered;
            });
        },

        flushTest: function () {return true;}
    };

    Pipeline.prototype.Task = Task;

    /*Y.extend(Pipeline, Y.Base, {
        initializer: function () {
        }
    });*/

    /*Y.extend(Task, Y.Base, {
        initialize: function (options) {

        }
    });*/

    Y.namespace('mojito.addons.ac').pipeline = Pipeline;
}, '0.0.1', {
    requires: [
        'mojito',
        'mojito-utils',
        'base-base',
        'target-action-events'
    ]
});