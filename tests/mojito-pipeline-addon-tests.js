/*jslint nomen: true, indent: 4, evil: true */
/*global YUI, YUITest */

YUI.add('mojito-pipeline-addon-tests', function (Y, NAME) {
    'use strict';

    var A = YUITest.Assert,
        Value = YUITest.Mock.Value,

        suite = new YUITest.TestSuite(NAME),
        Pipeline = Y.mojito.addons.ac.pipeline,
        command = {},
        ac,
        rs = {
            pipeline: {
                client: {}
            }
        };

    suite.add(new YUITest.TestCase({

        name: 'unit tests',

        setUp: function () {
            var adapter = {
                req: {}
            };
            ac = new Y.mojito.MockActionContext({
                addons: ['params', 'jscheck']
            });

            ac.expect({
                method: '_dispatch',
                args: [Value.Object, Value.Object]
            });

            ac.params.expect({
                method: 'all',
                returns: {}
            });

            ac.jscheck.expect({
                method: 'status',
                returns: 'enabled'
            });
            ac.jscheck.expect({
                method: 'run'
            });

            ac.pipeline = new Pipeline(command, adapter, ac);

            ac.pipeline.configure({
                sections: {
                    root: {
                        sections: {
                            'a': {}
                        }
                    },
                    a: {
                        helloa: 'worlda'
                    },
                    b: {
                        sections: {
                            ba: {
                                helloba: 'worldba'
                            }
                        }
                    }
                }
            });
            ac.pipeline.setStore(ac, rs);

        },

        'merge targets works as intended': function () {
            var targets1 = {
                    a: ['world'],
                    b: ['foo']
                },
                targets2 = {
                    a: ['hello'],
                    b: ['bar'],
                    c: ['baz']
                },
                merged = {
                    a: ['world', 'hello'],
                    b: ['foo', 'bar'],
                    c: ['baz']
                };
            // check result against expected merged targets
            Y.Object.each(Pipeline._mergeEventTargets(targets1, targets2), function (events, target) {
                A.areEqual(JSON.stringify(events), JSON.stringify(merged[target]));
            });
        },
        'configure method successfully flattens sections': function () {
            // confirm epect sections are indeed found in the flattened version
            Y.Array.each(['a', 'b', 'ba'], function (name) {
                A.isObject(ac.pipeline.data.sections[name]);
            });
        },
        'task initialized to error errors out synchronously, sets an error state': function () {
            var test = this,
                initialNumTasks = ac.pipeline.data.numUnprocessedTasks;
            ac.pipeline._flushQueuedTasks = function () {};
            ac.pipeline._push({ // sync push here to know the following line will be executed afterwards
                id: 'a',
                error: 'true'
            });
            A.isTrue(ac.pipeline._getTask('a').errored);
        },
        'task with no dependency renders synchronously and has an error subscription': function () {
            var renderCalled = false;
            ac.pipeline._render = function () {
                renderCalled = true;
            };
            ac.pipeline._push({ // sync push here to know the following line will be executed afterwards
                id: 'a'
            });
            A.isTrue(renderCalled);
            A.isNotNull(ac.pipeline._getTask('a').errorSubscription);
            A.isNull(ac.pipeline._getTask('a').renderSubscription);
        },
        'task that never renders has all default subscriptions': function () {
            ac.pipeline._push({ // sync push here to know the following line will be executed afterwards
                id: 'a',
                render: 'false'
            });
            A.isNotNull(ac.pipeline._getTask('a').errorSubscription);
            A.isNotNull(ac.pipeline._getTask('a').flushSubscription);
            A.isNotNull(ac.pipeline._getTask('a').renderSubscription);
        },
        'task that never renders and has a timeout is forced to render': function () {
            var test = this;
            ac.pipeline._render = function () {
                test.resume(A.pass);
            };
            ac.pipeline.push({
                id: 'a',
                render: 'false',
                timeout: 100
            });
            test.wait(200);
        },
        'timeouts are inherited down to dependencies and sections': function () {
            var test = this;
            ac.pipeline._push({
                id: 'a',
                dependencies: ['b'],
                timeout: 100
            });
            ac.pipeline._push({
                id: 'b' // b has 'ba' as section
            });
            ac.pipeline._push({
                id: 'ba',
                timeout: 200
            });
            A.areEqual(100, ac.pipeline._getTask('b').timeout);
            A.areEqual(100, ac.pipeline._getTask('ba').timeout);
        },
        'closed event subscription': function () {
            ac.pipeline.close();
            ac.pipeline._render = function (task) {
                A.areEqual('a', task.id);
            };
            ac.pipeline.push({
                id: 'a',
                render: 'pipeline.closed'
            });
        },
        'dependencies are render targets and they unblock their parent': function () {
            var renderCalled = false;
            ac.pipeline._render = function () {
                renderCalled = true;
                A.isNotUndefined(ac.pipeline._getTask('root').renderTargets.b);
            };
            ac.pipeline._push({
                id: 'root',
                dependencies: ['b']
            });
            ac.pipeline.close();
            ac.pipeline._push({
                id: 'b'
            });
            A.isTrue(renderCalled);
        },
        'render rules generate render targets and they unblock their parent': function () {
            var renderCalled = false;
            ac.pipeline._render = function () {
                renderCalled = true;
                A.isNotUndefined(ac.pipeline._getTask('b').renderTargets.c);
            };
            ac.pipeline._push({
                id: 'b',
                render: 'c.rendered'
            });

            ac.pipeline.close();
            A.isFalse(renderCalled);
            ac.pipeline._push({
                id: 'c'
            });

            A.isTrue(renderCalled);

        },
        'without client js, sections become render targets': function () {
            // force pipeline client to believe js is not enabled
            ac.pipeline.client.jsEnabled = false;
            ac.pipeline._push({
                id: 'a',
                sections: {
                    'b': {}
                }
            });
            A.isNotUndefined(ac.pipeline._getTask('a').renderTargets.b);
        },
        'without client js, flushTest is always false event for a task without dependencies': function () {
            ac.pipeline.client.jsEnabled = false;
            ac.pipeline.push({
                id: 'a'
            });
            A.isFalse(ac.pipeline._getTask('a').flushTest());
        },
        'without client js, render is blocked by normally non-blocking sections': function () {
            ac.pipeline.client.jsEnabled = false;
            ac.pipeline.push({
                id: 'a',
                sections: {
                    'b': {}
                }
            });
            ac.pipeline.push({
                id: 'b',
                render: 'false'
            });
            this.wait(function () {
                A.isFalse(ac.pipeline._getTask('a').renderTest(ac.pipeline));
            }, 0);
        },
        'toString returns a string': function () {
            ac.pipeline.push({
                id: 'a'
            });
            A.isString(ac.pipeline._getTask('a').toString());
        },
        'wrap returns a valid executable string': function () {
            var wrapped,
                pipeline = ac.pipeline; // the eval will need this in its context
            ac.pipeline.push({
                id: 'a'
            });
            wrapped = ac.pipeline._getTask('a').wrap();
            A.isString(wrapped);
            try {
                eval(wrapped);
                A.pass();
            } catch (e) {
                A.fail();
            }
        },
        'if a task is a section and it s rendered, verify it s in the flush queue': function () {
            ac.pipeline._getTask('a').rendered = true;
            ac.pipeline._push({ // sync push here to know the following line will be executed afterwards
                id: 'a'
            });
            ac.pipeline.data.events.fire('a', 'afterRender', function () {
                A.isTrue(Y.Array.some(ac.pipeline.data.flushQueue, function (task) {
                    return task.id === 'a';
                }));
            });
        },
        'if js not enabled, process root and tasks with adapter, force synchronous first task - expect no exception': function () {
            var rootDone = 0,
                tasksDone = 0;
            ac.expect({
                method: '_dispatch',
                args: [Value.Object, Value.Object],
                run: function (command, adapter) {
                    if (command.instance.type === 'Root') {
                        console.log('[mojito-pipeline-addon-tests.js:256] pushing b');
                        ac.pipeline.push({
                            id: 'b',
                            dependencies: ['ba']
                        });
                        console.log('[mojito-pipeline-addon-tests.js:260] pushing ba');
                        ac.pipeline.push({
                            id: 'ba'
                        });
                        ac.pipeline.done(function () {
                            adapter.done({}, {});
                        });
                    } else {
                        adapter.done({}, {});
                    }
                }
            });
            ac.expect({
                method: 'done',
                args: [Value.String, Value.Object]
            });
            ac.pipeline.client.jsEnabled = false;
            console.log('[mojito-pipeline-addon-tests.js:277] pshing root');
            ac.pipeline.push({
                id: 'root',
                type: 'Root'
            });
            ac.pipeline.close();
        }
    }));

    YUITest.TestRunner.add(suite);
}, '0.0.1', {
    requires: [
        'mojito-pipeline-addon',
        'mojito-util'
    ]
});