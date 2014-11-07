YUI.add('RootController', function (Y, NAME) {
    'use strict';
    Y.namespace('mojito.controllers')[NAME] = {
        index: function (ac) {
            ac.pipeline.push('hello');
            ac.pipeline.close();
            ac.done(ac.params.body().children);
        }
    };
}, '0.0.1', {
    requires: [
        'mojito-params-addon',
        'mojito-pipeline-addon'
    ]
});