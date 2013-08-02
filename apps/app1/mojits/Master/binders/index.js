YUI.add('MasterIndexBinder', function (Y, NAME) {
    Y.namespace('mojito.binders')[NAME] = {
        init: function (mojitProxy) {
var events = new Y.Pipeline.Events(this);

var subscription = events.subscribe({
    'a': [
        'render',
        'flush'
    ],
    'b': [
        'render'
    ]
}, function (event) {
    console.log(event.target + '.' + event.targetAction + ' was fired');
    if (event.target === 'b') {
        subscription.unsubscribe();
    }
});

events.fire('a', 'render'); // 'a.render was fired'
events.fire('b', 'render'); // 'b.render was fired'
events.fire('a', 'flush'); // nothing is loged because the subscribed action unsubscribes after b's event
        }
    }

}, '0.0.1', {
    requires: [
        'target-action-events'
    ]
});
