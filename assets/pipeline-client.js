YUI().use('target-action-events', function (Y) {

    var Pipeline = function (dummyPipeline) {
            this.events = new Y.Pipeline.Events();
            this.tasks = {};
            dummyPipeline.forEach(this.push.bind(this));
        },
        Task = function (config) {
            mix(this, config);
        };

    Pipeline.prototype.push = function (taskConfig) {
        var pipeline = this,
            task = this._getTask(taskConfig),
            displaySubscription;

        task.flushed = true;
        mix(task, taskConfig);

        // subscribe to any events specified by the task
        ['beforeDisplay', 'afterDisplay'].forEach(function (targetAction) {
            if (!task[targetAction]) return;

            var targets = {};
            targets[task.id] = [targetAction];
            this.events.subscribe(targets, task[targetAction]);
        }, this);

        // merge default displayTest with user provided test
        if (taskConfig.displayTest) {
            task.displayTest = function () {
                return Task.prototype.displayTest.call(task) && taskConfig.displayTest(pipeline);
            };
        }

        // subscribe to events for the display action
        if (task.displayTest()) {
            pipeline.display(task);
        } else {
            displaySubscription = this.events.subscribe(task.displayTargets, function (event, done) {
                if (task.displayTest(task)) {
                    displaySubscription.unsubscribe();
                    pipeline.display(task, done);
                } else {
                    done();
                }
            });
        }
    };

    Pipeline.prototype._getTask = function (config) {
        if (typeof config === 'string' || typeof config === 'number') {
            return this.tasks[config] = (this.tasks[config] || new Task({ id: config }));
        }
        var task = this.tasks[config.id];
        if (task) {
            mix(task, config);
        } else {
            task = this.tasks[config.id] = new Task(config);
        }
        return task;
    };

    Pipeline.prototype.display = function (task) {
        var stub = document.getElementById(task.id + '-section'),
            pipeline = this;
        this.events.fire(task.id, 'beforeDisplay', function () {
            var makerNode = document.createElement();
            makerNode.innerHTML = unescape(task.markup);

            for (var i = 0; i < makerNode.children.length; i++) stub.parentNode.insertBefore(makerNode.children[i], stub);

            task.displayed = true;

            pipeline.events.fire(task.id, 'afterDisplay');
            task.embeddedChildren.forEach(function (value) {
                pipeline.events.fire(value, 'afterDisplay');
            });
        });
    };

    Task.prototype.displayTest = function () {
        return !!document.getElementById(this.id + '-section');
    };

    pipeline = new Pipeline(pipeline);

});