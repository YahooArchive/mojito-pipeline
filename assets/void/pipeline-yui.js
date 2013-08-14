/*jslint forin: true */
var pipeline = [];

// a simple function that mixes and overwrites the receiver with the supplier
function mix(receiver, supplier) {
    'use strict';
    var p;
    for (p in supplier) {
        receiver[p] = supplier[p];
    }
}

if (typeof YUI === 'undefined') {
    YUI = function () {
        'use strict';
        return {
            use: function () {
                var Y = {
                    Pipeline: YUI.Pipeline
                };
                arguments[arguments.length - 1](Y);
            }
        };
    };
    YUI.Pipeline = {};
    YUI.add = function (moduleName, module) {
        'use strict';
        var Y = {
            namespace: function () {
                return YUI.Pipeline;
            }
        };
        module(Y);
    };
}
