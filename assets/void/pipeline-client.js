/*jslint browser: true, indent: 4, plusplus: true */
/*global unescape */

var pipeline = (function () {
    'use strict';

    //-- Private variables ----------------------------------------------------

    var events = new window.Pipeline.Events(),
        tasks = {};

    //-- Private methods ------------------------------------------------------

    function mix(receiver, supplier) {
        var p;

        for (p in supplier) {
            if (supplier.hasOwnProperty(p)) {
                receiver[p] = supplier[p];
            }
        }
    }

    function Task(config) {
        mix(this, config);
    }

    Task.prototype.displayTest = function () {
        return !!document.getElementById(this.id + '-section');
    };

    function getTask(config) {
        if (typeof config === 'string' || typeof config === 'number') {
            tasks[config] = (tasks[config] || new Task({ id: config }));
            return tasks[config];
        }

        var task = tasks[config.id];

        if (task) {
            mix(task, config);
        } else {
            task = tasks[config.id] = new Task(config);
        }

        return task;
    }

    // Public methods ---------------------------------------------------------

    return {

        push: function (taskConfig) {
            var pipeline = this,
                task = getTask(taskConfig),
                displaySubscription;

            task.flushed = true;
            mix(task, taskConfig);

            // subscribe to any events specified by the task
            ['beforeDisplay', 'afterDisplay'].forEach(function (targetAction) {
                if (!task[targetAction]) {
                    return;
                }

                var targets = {};
                targets[task.id] = [targetAction];
                events.subscribe(targets, task[targetAction]);
            }, this);

            // merge default displayTest with user provided test
            if (taskConfig.displayTest) {
                task.displayTest = function () {
                    return Task.prototype.displayTest.call(task) && taskConfig.displayTest(pipeline);
                };
            }

            // subscribe to events for the display action
            if (task.displayTest()) {
                pipeline.display(task);
            } else {
                displaySubscription = events.subscribe(task.displayTargets, function (event, done) {
                    if (task.displayTest(task)) {
                        displaySubscription.unsubscribe();
                        pipeline.display(task, done);
                    } else {
                        done();
                    }
                });
            }
        },

        display: function (task) {
            var stub = document.getElementById(task.id + '-section');

            events.fire(task.id, 'beforeDisplay', function () {
                var i, n;

                n = document.createElement('div');
                n.innerHTML = unescape(task.markup);

                for (i = 0; i < n.children.length; i++) {
                    stub.parentNode.insertBefore(n.children[i], stub);
                }

                task.displayed = true;

                events.fire(task.id, 'afterDisplay');

                task.embeddedChildren.forEach(function (value) {
                    events.fire(value, 'afterDisplay');
                });
            });
        }
    };

}());