# mojito-pipeline [![Build Status](https://travis-ci.org/yahoo/mojito-pipeline.svg)](https://travis-ci.org/yahoo/mojito-pipeline)

mojito-pipeline is a [mojito](https://developer.yahoo.com/cocktails/mojito) extension that allows applications to render mojits as soon as their data is availble. It manages all the execution stages of a mojit and pregressively flushes and displays content to the user agent. This process siginificanlty improves front-end performance by immediately showing parts of the page while concurrently rendering mojits as data arrives.

[![NPM](https://nodei.co/npm/mojito-pipeline.png)](https://nodei.co/npm/mojito-pipeline/)

## Table of contents
* [Overview](#overview)
* [Getting Started](#getting-started)
* [Hello World! Example](#hello-world!-example)
* [Mojit Lifecycle](#life-cycle)
* [Configuration](#configuration)
* [API](#api)
* [Events](#events)

## Overview

### Features
* Reduces time to first/last byte
* Supports client-side disabled JavaScript
* Supports [Shaker](https://developer.yahoo.com/cocktails/shaker/) (automatically minifies/combines css/js assets)
* Allows full control of mojit execution stages
* Client/server side event subscription
* Error/timeout handling and reporting
* Easy to use, just requires simple [configuration](#configuration) and the use of [pipeline.push](#api-push) and [pipeline.close](#api-close)


### How it works

Pipeline consists of three components:

* **PipelineFrame**: The PipelineFrame, or the Shaker equivalent ShakerPipelineFrame, is a frame mojit, similar to Mojito's [HTMLFrameMojit](https://developer.yahoo.com/cocktails/mojito/docs/topics/mojito_frame_mojits.html). It accepts one root level mojit, which it sorrounds with a full html page frame, including `html`, `head`, and `body` tags. It is responsible for embedding the PipelineClient (see [below](#pipeline-client)), and periodically flushing content to the client, including css/js assets. It accepts a configuration consisting of a tree of mojits that can appear on the page (see [configuration](#configuration)).

* **Pipeline Addon**: The Pipeline addon implements [Pipeline's api](#api), which allows users to [push](#api-push) mojits and [close](#api-close) the pipeline, among other calls. It is responsible for processing mojits throughout their various stages (see [mojit lifecycle](#mojit-lifecycle)), while allowing concurrency between data retrieval, mojit execution, and the flushing of content.

* **Pipeline Client**: The Pipeline client handles the displaying of mojits on the client side. It is minified and inline on the first flush to the client. The Pipeline client consist of a global `pipeline` object, which is used to deserialize flushed mojits and display them, observing any user defined displaying rules.


## Getting Started

mojito-pipeline requires a Mojito application (Take a look at the [Mojito Quickstart](https://developer.yahoo.com/cocktails/mojito/docs/getting_started/quickstart.html))

1. Install mojito-pipeline in the Mojito application:

        $ npm install mojito-pipeline

2. Recommended. Install mojito-shaker ([Shaker](https://developer.yahoo.com/cocktails/shaker/) automatically processes assets):

	    $ npm install mojito-shaker

3. Add or modify a route's configuration to use the `PipelineFrame` or `ShakerPipelineFrame` (see [Configuration](#configuration)).

4. Push mojits into the pipeline using [ac.pipeline.push](#api-push).

5. Close the pipeline using [ac.pipeline.close](#api-close), after all mojits have been pushed.

Take a look at the ["Hello World! example"](#hello-world!-example) below or follow the wiki's thorough explanation of a full [example application](https://github.com/yahoo/mojito-pipeline/tree/master/examples/search).

## Hello World! Example

1. Create a new "hello-page" route and point that route to application specs that use the `PipelineFrame` mojit:

	**routes.json**
	```js
	{
		"hello-page": {
        "verbs": ["get"],
        "path": "/hello",
        "call": "hello"
	}
	```
	
	**application.json**
	```js
	{
		"settings": ["master"]
		"specs": {
			"hello": {
				"type": "PipelineFrame",
				"child": {
					"type": "Root",
					"children": {
						"hello": {
							"type": "Hello"
						}
					}
				}
			}
		}
	}
	```

The "hello-page" route specifies that the "hello" application specs should be used for the "/hello" path. The specs refer to the `PipelineFrame` mojit, which has one child of mojit type `Root`, which only specifies `hello` as a child under its `children` map (see [Configuration](#configuration)).

2. Create two mojits, `Root` and `Hello`.

3. The `Hello` mojit's controller simply passes the string "Hello world!" to its view:

    **mojits/Hello/controller.server.js**
	```js
	YUI.add('HelloController', function (Y, NAME) {
	    Y.namespace('mojito.controllers')[NAME] = {
	        index: function () {
	            ac.done({
	                text: "Hello World!"
	            });
	        }
        };
	});
	```
	
	**mojits/Hello/views/index.hb.html**
	```html
	<div>{{text}}</div>
	```

4. The `Root` mojit has a single child `hello`, which it pushes to the pipeline:

	**mojits/Root/controller.server.js**
	```js
	YUI.add('RootController', function (Y, NAME) {
		Y.namespace('mojito.controllers')[NAME] = {
			index: function (ac) {
				ac.pipeline.push('hello');
				ac.pipeline.close();
				ac.done(ac.params.body().children);
			}
		}
	}, '0.0.1', {
		requires: [
			'mojito-params-addon'
			'mojito-pipeline'
		]
	});
	```
	
	**mojits/Root/views/index.hb.html**
	```html
	<div>
		{{{hello}}}
	</div>
	```
	
	The `Root` controller simply pushes its only child mojit, reference by its `hello` id. It then closes the pipeline and passes its children data to its view. As specified in the configuration above, the top level mojit is of type `Root`, which automatically gets pushed to the pipeline. Pipeline always refers to the top level mojit as `root`. Before `root` is dispatched, Pipeline populates its `params.body.children` with the rendered data of its children. In this case `root` only has one child, `hello`, which hasn't been rendered so `ac.params.body().children.hello` is equal to `&lt;div id="hello-section"&gt;&lt;/div&gt;`. This is a placeholder for the `hello` child, which Pipeline will fill, whenever `hello` is fully rendered, either before rendering `root` or on the client side.


## Mojit Lifecycle

After being pushed into the pipeline, mojits undergo various stages before finally being displayed on the client. Pipeline is fully responsible for processing mojits along these stages, but also allows users to precisely control and hook into mojit execution through [execution rules](#configuration-rules) and [event subscription](#events-subscription).

Stage Action | Resulting State   | Description 
-------------|-------------------|----------------------------------------------------------------------------
push         | `pushed`          | The mojit has just been pushed using [ac.pipeline.push](#api-push)
dispatch     | `dispatched`      | The mojit's controller has been called
render       | `rendered`        | The data passed to ac.done has been used to render the mojit's view
flush        | `flushed`         | The mojit has been added to the flush queue and will be sent to the client
display      | `displayed`       | The mojit has been displayed on the client side


**Exception States**

Exception | Resulting State   | Description
----------|-------------------|-------------------------------------------------------------------------------
timeout   | `timedout`        | The mojit timed out after dependencies prevented it from being dispatched
error     | `errored`         | There was an error while dispatching the mojit or its error rule returned true


## Configuration

### Application Specs






#API Doc.
##Static and runtime task configuration
###what is `runtimeTaskConfig` in `ac.pipeline.push(runtimeTaskConfig);`?
the object passed to the `ac.pipeline.push` method will be merged with the static mojit configuration listed in application.yaml under the corresponding id. It is expected that static configurations will be located in the application.yaml, whereas the configurations that require runtime, will be the members of `runtimeTaskConfig`. If listed in both application.yaml and in the `runtimeTaskConfig`, properties will be overridden by the latter.
Here is the list of the members that a task can receive that are meaningful to pipeline:
###`id`
the id that this task can be referenced with (in business rules or when setting dependencies)
###`type`
the mojit type that the task should instantiate. This is a normal mojito parameter.
###`sections`
an `Object` defining this task's children sections (see terminology above) indexed by the task ids of those sections.
###`dependencies`
an `Array` containing the ids of this task's dependencies (see terminology above).
###`default`
a `Boolean` indicating whether this task should be automatically pushed by it's parent with the static config (see terminology above).
###`group`
a `String` of a name for an Array allocated in the ac.params.body('children') of the parent of this task where all the rendered tasks having the same group name will be listed when they are rendered. Grouped tasks will usually be defined at runtime and be dependencies/blocking of their parent.
###`timeout`
a `Number` representing the time in milliseconds that this task should stay blocked on its dependencies before it should be forced to unblock itself.
###action rules
there is 4 possible action rules that can be defined by the user. their names are `render`, `flush`, `display`, and `error`.
Each rule defines the condition that should trigger a new stage in the lifecycle of the task (see the lifecycle of a task above).
Each rule is a `String` that symbolizes boolean expressions based on javascript's syntax. Each term of the expression can be a boolean `true` or `false`, or another expression based on a task attributes/states. To refer to a task in a rule, you can use the dot-notation on the task id just as if it was a javascript object. example (taken from the example above):
```yaml
                            "ads": {
                                "type": "Ads",
                                "render": "search-results.rendered",
                                "sections": {
					# ...
                                }
                            }
```
In this example, the `'render'` rule means "render 'ads' whenever 'search-results' is rendered". The states of a task that you can use are: `'pushed'`, `'dispatched'`, `'rendered'`, `'flushed'`, `'displayed'`, `'errored'` and `'timedOut'`.
In addition you can use the `'closed'` state on the id `'pipeline'` (just try to not call any of you tasks 'pipeline'...).

##ac.pipeline.push(Object taskConfig)
Pushes a given task into the pippeline. This task will be processed according to the configuration given to the pipeline and the `taskConfig` object.
This call is non-blocking: upon return, the task will exist in the pipeline but will not have started its lifecyle.
### taskConfig
Some additional task configuration that will be merged with the configuration given to the pipeline in application.yaml.
See the [API above](https://github.com/yahoo/mojito-pipeline/blob/master/README.md#static-and-runtime-task-configuration) for more details about this object.
##ac.pipeline.close()
Indicates to Pipeline that no more tasks will be pushed. The pipeline will trigger its 'onClose' event, flush the remaining tasks and send the closing markup.



#Code Structure
##addons
###ac/pipeline.server.js
Exposes the main access points into the pipeline. Implements the public ac.pipeline addon and private `Task` class.
###rs/pipeline.server.js
Handles pipeline's client-side minification
##assets/void/pipeline-client.js
The client-side piece of the pipeline that handles the end of the processing of the tasks that are shipped to the client.
##mojits
###PipelineHTMLFrameMojit
A replacement for mojito's HTMLFrameMojit that handles pipelining of the frame.
###ShakerPipelineHTMLFrameMojit
A replacement for mojito's HTMLFrameMojit that handles both pipelining and mojito-shaker
###yui_modules/target-action-events.common.js
An implementation of a publish-subscribe model that lets the subscriber choose multiple publishers and multiple events at a time.
