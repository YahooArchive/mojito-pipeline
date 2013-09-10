YUI.add('MasterIndexBinder', function (Y, NAME) {
    'use strict';
    Y.namespace('mojito.binders')[NAME] = {
        init: function (mojitProxy) {
            var events = new Y.Pipeline.Events(this),
                subscription = events.subscribe({
                    'a': [
                        'render',
                        'flush'
                    ],
                    'b': [
                        'render'
                    ]
                }, function (event, optArg1, optArg2) {
                    // console.log(event.target + '.' + event.targetAction + ' was fired: ' + optArg1 + ' ' + optArg2);
                    if (event.target === 'b') {
                        subscription.unsubscribe();
                    }
                });

            events.fire('a', 'render', 'arg1', 'arg2'); // 'a.render was fired'
            events.fire('b', 'render', 1, 2); // 'b.render was fired'
            events.fire('a', 'flush'); // nothing is loged because the subscribed action unsubscribes after b's event
        }
    };

}, '0.0.1', {
    requires: [
        'target-action-events'
    ]
});
