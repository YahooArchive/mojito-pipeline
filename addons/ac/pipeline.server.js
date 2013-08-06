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

        this.unrenderedTasks = 0;
    }
    function Task() {
        Task.superclass.constructor.apply(this, arguments);
    }

    Y.extend(Pipeline, Y.Base, {
        namespace: 'pipeline',
        initializer: function (config) {
            this.sections     = config.sections;
            this._pushedTasks = {};
            this._flushQueue  = [];
            this._resolveRules();
            this.events = new Y.Pipeline.Events(this);
        }
    });

    Pipeline.prototype.render = function (task) {
        this.events.fire(task.id, 'beforeRender');
        // TODO: create action context
        // TODO: execute mojit
        // TODO: execute any actions subscribe to this task's render event
        // TODO: test flush condition, if true put in flush queue, else subscribe to events

    };

    Pipeline.prototype.flushQueue = function () {
        while (this._flushQueue.length) {
            this._flushQueue.shift().flush();
        }
    };

    Pipeline.prototype.getTask = function (id) {
        return this._pushedTasks[id];
    };

    Pipeline.prototype.push = function (task) {
        var pipeline = this,
            renderRuleTargets = {},
            flushRuleTargets = {};
        task.pipeline = pipeline;

        // keep track to know when to flush the batch
        this.unrenderedTasks++;
        this._pushedTasks[task.id] = task;

        // for each section in the config
        Y.Object.each(task.sections, function (config, sectionId) {

            // push the default sections if they're not already there
            if (config['default'] && !this.getTask(sectionId)) {
                this.push(new Task({
                    id: sectionId,
                    config: config
                }));
            }
            // build the targets for the render rule of the task
            renderRuleTargets[sectionId] = ['render'];
        }, this);

        // TODO: parse the render rules and combine the tests with sectionsRenderTest
        task.renderTest = Task._combineTests(task.renderTest, task._sectionsRenderTest.bind(task));

        // subscribe to the events triggering the render action under some condition
        this.attachAction('render', renderRuleTargets, task.renderTest.bind(task), function () {

            // when the rendering is done, push the task in the queue
            pipeline._flushQueue.push(task);
            // check if this was the last task in the current batch (uninterrupted js event loop)
            pipeline.unrenderedTasks--;
            if (pipeline.unrenderedTasks === 0) {
                // if so, empty the queue
                pipeline.flushQueue();
            }
        });
    };

    Pipeline.prototype.close = function () {

    };

    Y.extend(Task, Y.Base, {
        initialize: function (options) {
            this.config        = options.config;
            this.id            = options.id;
            this.action        = options.action;
            this.sections      = this.config.sections;
            this._templateData = {};
            this._rendered     = undefined;
        }
    });

    Task.prototype.attachAction = function (action, targets, testFn, afterAction) {
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
    };
    Task.prototype.render = function () {
        // this.pipeline.render(this);
    };
    Task.prototype.flush = function () {
        // this.prototype.flush();
    };
    Task._combineTests = function () {
        return function () {
            return !Y.Array.some(arguments, function (nextFn) {
                return !nextFn.call();
            });
        };
    };
    Task.prototype._sectionsRenderTest = function () {
        return !Y.Object.some(this.sections, function (sectionConfig, sectionId) {
            return !this.pipeline.getTask(sectionId).rendered;
        }, this);
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