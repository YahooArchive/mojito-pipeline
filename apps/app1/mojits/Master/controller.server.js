YUI.add('MasterController', function (Y, NAME) {
    'use strict';
    Y.namespace('mojito.controllers')[NAME] = {
        index: function (ac) {
            ac.assets.addCss('/static/app/assets/base.css');
            ac.assets.addCss('./master.css');
            ac.done();
        }
    };
}, '0.0.1', {
    requires: [
        'mojito-assets-addon'
    ]
});
