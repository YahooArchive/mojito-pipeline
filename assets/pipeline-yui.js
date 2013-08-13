var pipeline = [];

// a simple function that mixes and overwrites the receiver with the supplier
function mix(receiver, supplier) {
    for (var p in supplier) {
        receiver[p] = supplier[p];
    }
};

if (!YUI) {
    YUI = function () {
        this.use = function () {
            var Y = {
                Pipeline: YUI.Pipeline
            };
            arguments[arguments.length - 1](Y);
        };
    };
    YUI.Pipeline = {};
    YUI.add = function () {
        var Y = {
            namespace: function () {
                return YUI.Pipeline;
            }
        };
        arguments[arguments.length - 1](Y);
    };
}
