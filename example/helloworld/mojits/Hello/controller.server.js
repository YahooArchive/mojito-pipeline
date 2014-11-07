YUI.add('HelloController', function (Y, NAME) {
    'use strict';
    Y.namespace('mojito.controllers')[NAME] = {
        index: function (ac) {
            ac.done({
                text: "Hello World!"
            });
        }
    };
});