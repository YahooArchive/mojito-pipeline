/*jslint nomen: true, indent: 4, plusplus: true, stupid: true */
/*global YUI, YUITest */

YUI.add('mojito-pipeline-addon-tests', function (Y, NAME) {
    'use strict';

    var A = YUITest.Assert,
        Value = YUITest.Mock.Value,
        NOOP = function () {},
        suite = new YUITest.TestSuite(NAME),
        appConfig = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'application.json')))[0],
        Pipeline,
        mojits = {
            PipelineFrame: function (ac) {
                var child = ac.config.child;
                child.id = 'root';
                ac.pipeline.initialize({
                    sections: {
                        root: child
                    }
                });
                ac.pipeline.push(child);
            },
            Pusher: function (ac) {
                var pushGroups = ac.config.push,
                    config = ac.config;

                Y.Object.each(pushGroups, function (pushGroup, time) {
                    time = Number(time);
                    var pushTasks = function () {
                        Y.Array.each(pushGroup, function (task) {
                            if (task === 'close') {
                                return ac.pipeline.close();
                            }
                            var taskConfig = task === '' ? {} : Y.mix({id: task}, ac.pipeline.sections[task] || {});
                            ac.pipeline.push(taskConfig);
                        });
                    };
                    if (time === 0) {
                        pushTasks();
                    } else {
                        setTimeout(pushTasks, time);
                    }
                });
            },
            Noop: NOOP
        },
        Mojito = {
            route: function (route, jsEnabled, test, callback) {
                var adapter = {
                        req: {}
                    },
                    command = {
                        params: {}
                    },
                    rs = {
                        pipeline: {
                            client: ''
                        }
                    },
                    routeConfig = Y.clone(appConfig.specs[route]),
                    ac = new Y.mojito.MockActionContext({
                        addons: ['jscheck']
                    }),
                    results = {
                        pushed: [],
                        dispatched: [],
                        rendered: [],
                        flushed: [],
                        flushes: 0,
                        closed: false
                    },
                    expected = (routeConfig.expected && routeConfig.expected[jsEnabled ? 'js' : 'nojs']) || {};

                ac.jscheck.expect({
                    method: 'run',
                    callCount: 1,
                    run: NOOP
                }, {
                    method: 'status',
                    callCount: 1,
                    run: function () {
                        return jsEnabled ? 'enabled' : 'disabled';
                    }
                });

                ac.expect({
                    method: 'done',
                    args: [Value.String, Value.Object],
                    callCount: 1
                }, {
                    method: 'flush',
                    args: [Value.String, Value.Object],
                    callCount: expected.acFlushCount,
                    run: NOOP
                }, {
                    method: '_dispatch',
                    args: [Value.Object, Value.Object],
                    callCount: expected.acDispatchCount,
                    run: function (command, adapter) {
                        var childAc = {
                            config: command.instance.config,
                            command: command,
                            adapter: adapter,
                            error: command.instance.config && command.instance.config.error
                        };

                        childAc.pipeline = new Pipeline(command, adapter, childAc);

                        mojits[command.instance.type](childAc);
                        Y.mojito.ActionContext.prototype.done.apply(childAc, [{}]);
                    }
                });

                ac.config = routeConfig.config;

                ac.pipeline = new Pipeline(command, adapter, ac);
                ac.pipeline.setStore(rs);

                // Hook into pipeline methods to populate results
                ac.pipeline.push = function (taskConfig) {
                    taskConfig.type = taskConfig.type === undefined ? 'Noop' : taskConfig.type;
                    var id = Pipeline.prototype.push.apply(this, arguments);
                    results.pushed.push(id);
                };
                ac.pipeline._dispatch = function (task) {
                    results.dispatched.push(task.id);
                    Pipeline.prototype._dispatch.apply(this, arguments);
                };
                ac.pipeline._render = function (task) {
                    results.rendered.push(task.id);
                    Pipeline.prototype._render.apply(this, arguments);
                };
                ac.pipeline._flushEnqueue = function (task) {
                    results.flushed.push(task.id);
                    Pipeline.prototype._flushEnqueue.apply(this, arguments);
                };

                // Conclude test once pipeline has finished
                ac.pipeline._flushQueuedTasks = function () {
                    Pipeline.prototype._flushQueuedTasks.apply(this, arguments);
                    if (this._closeCalled) {
                        results.closed = true;
                        ac.pipeline._flushQueuedTasks = NOOP;
                        // If one of the mocks fail, resume will end up being called twice so we should ignore the first one
                        //YUITest.TestRunner._waiting = true;
                        test.resume(function () {
                            ac.verify();
                            Mojito._compareResults(expected, results, test);
                            return callback && callback(ac.pipeline, results);
                        });
                    }
                };


                // Run Frame specified in the spec
                mojits[routeConfig.type](ac);

                // Make test wait
                test.wait(100, function () {
                    A.fail('Pipeline never closed.');
                });


                return ac.pipeline;
            },

            // TODO also compare the logs generated.
            _compareResults: function (expected, results, test) {
                var compareArray = function (arr1, arr2, type) {
                    A.areEqual(arr1.length, arr2.length, 'Unexpected ' + type + ' array length.');
                    Y.Array.each(arr1, function (value, index) {
                        if (value !== arr2[index]) {
                            return test.fail('Unexpected ' + type + ' results.\nExpected ' + arr1 + '\nAcutal ' + arr2);
                        }
                    });
                };

                Y.Object.each(expected, function (expectedResult, expectedResultType) {
                    var actualResult = results[expectedResultType];
                    if (actualResult !== undefined && actualResult !== expectedResult) {
                        A.areSame(typeof actualResult, typeof expectedResult, 'Unexpected type in ' + expectedResultType + ' results.');
                        if (Y.Lang.isArray(expectedResult)) {
                            compareArray(expectedResult, actualResult, expectedResultType);
                        } else {
                            A.areSame(expectedResult, actualResult, 'Unexpected ' + expectedResultType + ' results.');
                        }
                    }
                });
            }
        };

    Y.mojito.ActionContext.prototype.done = function () {
        this.adapter.callback(this.error, 'Rendered', {});
    };
    Y.use('mojito-pipeline-addon');
    Pipeline = Y.mojito.addons.ac.pipeline;

    suite.add(new YUITest.TestCase({

        name: 'unit tests',

        'Test user rules (JS)': function () {
            Mojito.route('Route 1', true, this, function (pipeline) {
                A.areSame(pipeline._tasks.root.toString(), 'Rendered');
            });
        },

        'Test user rules (No JS)': function () {
            Mojito.route('Route 1', false, this);
        },

        'Test error conditions (JS)': function () {
            Mojito.route('Route 2', true, this);
        },

        'Test misc task config options (JS)': function () {
            Mojito.route('Route 3', true, this);
        }
    }));

    YUITest.TestRunner.add(suite);
}, '0.0.1', {
    requires: [
        'mojito-util',
        'mojito-action-context'
    ]
});