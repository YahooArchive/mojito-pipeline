YUI.add('HelloController', function (Y, NAME) {
    Y.namespace('mojito.controllers')[NAME] = {
        index: function (ac) {
            ac.done({
                text: "Hello World!"
            });
        }
    };
});