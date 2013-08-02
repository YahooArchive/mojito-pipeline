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
        Pipeline.superclass.constructor.apply(this, {
            command: command,
            adapter: adapter,
            ac: ac
        });

        this.events = new Y.Pipeline.Events();
        this.Task.prototype.pipeline = this;

        this.on('rendered', dispatchRender);
        this.numPushedTasks = 0;
    }

    Y.extend(Pipeline, Y.Base, {
        namespace: 'pipeline',
        initializer: function (config) {
            this.sections = config.sections;
            this.events = {};
            this._resolveRules();
            this._flushQueue = [];
        }
    });
    Pipeline.prototype._resolveRules = function () {
        // this.rules = ...
    };
    Pipeline.prototype.render = function (task) {
        // TODO: create action context
        // TODO: execute mojit
        // TODO: execute any actions subscribe to this task's render event
        // TODO: test flush condition, if true put in flush queue, else subscribe to events

    };
    Pipeline.prototype.flushQueue = function () {
    };
    Pipeline.prototype.getTask = function (id) {
    };
    Pipeline.prototype.push = function (task) {
        // increment number of pushed tasks
        // once all the pushed tasks have been handled, we need to flush anything in the flush queue
        this.numPushedTasks++;

        // TODO: create tasks for any default child section of this task

        // release control in order to make this method asynchronous
        process.nextTick();

        var pipeline = this,
            child,
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
            pipeline.render(function () {
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
    };
    Pipeline.prototype.close = function () {
    };

    function Task() {
        Task.superclass.constructor.apply(this, arguments);
    }
    Y.extend(Task, Y.Base, {
        initialize: function (options) {
            this.config = options.config;
            this.id = options.id;
            this.action = options.action;
            this.children = options.children;
        }
    });
    Task.prototype.render = function () {
        // this.pipeline.render(this);
    };
    Task.prototype.flush = function () {
        // this.prototype.flush();
    };

    Task.prototype.renderTest = Task.prototype.flushTest = function () {
        return true;
    };

    Pipeline.prototype.Task = Task;
    Pipeline.NAME = 'pipeline';
    Y.namespace('mojito.addons.ac').pipeline = Pipeline;
}, '0.0.1', {
    requires: [
        'base-base',
        'target-action-events'
    ]
});