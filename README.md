mojito-pipeline
===============

##Task
### dependencies - members
	* children: ["child1", "child2"] - synchronous children
	* renderWith: ["asyncChild1", "asyncChild2"] - async children
	* displayAfter: ["head", "body"] - client side display control

### fire: states/events – when to fire / functions must call this.fire('someEvent')
	* error: dispatchError(pipeline) {Function} {default: on error from one of renderWith or if exception}
	* timeout: dispatchTimeout(pipeline)|100 [Function|Number] {default: on timeout from one of renderWith or if timeout}
	* rendered: dispatchRendered(pipeline) {Function} {default: after render}
	* flushed: dispatchFlushed(pipeline) {Function} {default: after flushed}
	* displayed: dispatchDisplayed(clientPipeline) {Function} {default: after display / on show}

### targets: tasks - what event sources to subscribe to / '*' would be the pipeline/all targets
	* error: ["importantTask1", "importantTask2"] {Array} {default: the renderWith config}
	* timeout: ["importantTask1", "importantTask2"] {Array} {default: the renderWith config}
	* rendered: ["child1", "child2"] {Array} {default: the renderWith config}
	* flushed: "body" {String} {default: the flushAfter config}
	* displayed: ["header", "body"] {Array} {default: the displayAfter config}


	"master": {
		"type": "Master",
		"config": {
			""
		}
	}

	Task
		footerChild.on('render', function () {
			this.render(function () {
				body.on('flushed', function() {
					this.flush();
				});
			}
		});


	Master
		for (acticle in articles)
			pipeline.push(new Task(cfg.get(article.type).mojitoConfig.task));

