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
                var child = ac.command.instance.config.child;
                child.id = 'root';
                ac.pipeline.initialize({});
                ac.pipeline.push(child);
            },
            Pusher: function (ac) {
                var config = ac.command.instance.config,
                    pushGroups = config.push;

                Y.Object.each(pushGroups, function (pushGroup, time) {
                    time = Number(time);
                    var pushTasks = function () {
                        Y.Array.each(pushGroup, function (task) {
                            if (task === 'close') {
                                return ac.pipeline.close();
                            }
                            var taskConfig = task === '' ? {} : Y.mix({id: task}, ac.pipeline.specs[task] || {});
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
            route: function (route, pipelineClient, js, test, callback) {
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
                        addons: ['config', 'jscheck']
                    }),
                    results = {
                        pushed: [],
                        dispatched: [],
                        rendered: [],
                        flushed: [],
                        flushes: 0,
                        closed: false
                    },
                    jsEnabled = js === 'js',
                    expected = (routeConfig.expected && routeConfig.expected[js]) || {};

                ac.command = {
                    instance: {
                        config: routeConfig.config || {}
                    }
                };

                if (pipelineClient !== null) {
                    ac.command.instance.config.pipelineClient = pipelineClient;
                }

                ac.config.expect({
                    method: 'get',
                    args: [Value.String],
                    callCount: 1,
                    run: function (name) {
                        return ac.command.instance.config[name];
                    }
                });

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
                delete expected.acDispatchCount;
                delete expected.acFlushCount;

                ac.pipeline = new Pipeline(command, adapter, ac);
                ac.pipeline.setStore(rs);

                // Hook into pipeline methods to populate results
                ac.pipeline.push = function (taskConfig) {
                    taskConfig = Y.Lang.isString(taskConfig) ? {id: taskConfig} : taskConfig;
                    taskConfig.type = taskConfig.type === undefined ? 'Noop' : taskConfig.type;
                    var id = Pipeline.prototype.push.call(this, taskConfig);
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
                        results.tasks = ac.pipeline._tasks;

                        ac.pipeline._flushQueuedTasks = NOOP;
                        // If one of the mocks fail, resume will end up being called twice so we should ignore the first one
                        YUITest.TestRunner._waiting = true;
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
                (function compare(expected, actual, path) {
                    A.areSame(Y.Lang.type(expected), Y.Lang.type(actual), 'Unexpected type in ' + path);
                    if (Y.Lang.isArray(actual)) {
                        A.areEqual(expected.length, actual.length, 'Unexpected array length in ' + path);
                        Y.Array.each(expected, function (expectedValue, index) {
                            compare(expectedValue, actual[index], path + '[' + index + ']');
                        });
                    } else if (Y.Lang.isObject(expected)) {
                        Y.Object.each(expected, function (expectedValue, type) {
                            compare(expectedValue, actual[type], path + '->' + type);
                        });
                    } else {
                        A.areSame(expected, actual, 'Unexpected result in ' + path);
                    }
                }(expected, results, 'results'));
            }
        };

    Y.mojito.ActionContext.prototype.done = function () {
        this.adapter.callback(this.error, 'Rendered', {});
    };
    Y.use('mojito-pipeline-addon');
    Pipeline = Y.mojito.addons.ac.pipeline;

    suite.add(new YUITest.TestCase({

        name: 'unit tests',

        'Test user rules (Client, JS)': function () {
            Mojito.route('Route 1', null, 'js', this, function (pipeline) {
                A.areSame(pipeline._tasks.root.data, 'Rendered');
            });
        },

        'Test user rules (Client, No JS)': function () {
            Mojito.route('Route 1', null, 'nojs', this);
        },

        'Test user rules (No Client, No JS)': function () {
            Mojito.route('Route 1', false, 'nojs', this);
        },

        'Test error conditions (Client, JS)': function () {
            Mojito.route('Route 2', null, 'js', this);
        },

        'Test misc task config options (Client, JS)': function () {
            Mojito.route('Route 3', null, 'js', this);
        }
    }));

    YUITest.TestRunner.add(suite);
}, '0.0.1', {
    requires: [
        'mojito-util',
        'mojito-action-context'
    ]
});
