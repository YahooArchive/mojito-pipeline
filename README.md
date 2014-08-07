# mojito-pipeline [![Build Status](https://travis-ci.org/yahoo/mojito-pipeline.svg)](https://travis-ci.org/yahoo/mojito-pipeline)

mojito-pipeline is a [Mojito](https://developer.yahoo.com/cocktails/mojito) extension that allows applications to render [mojits](https://developer.yahoo.com/cocktails/mojito/docs/intro/mojito_apps.html#mojits) as soon as their data is available. It manages all the [execution stages](#mojit-lifecycle) of a mojit and progressively flushes and displays content to the user agent. This process significantly improves front-end performance by immediately displaying sections of the page while concurrently rendering mojits as data arrives.

[![NPM](https://nodei.co/npm/mojito-pipeline.png)](https://nodei.co/npm/mojito-pipeline/)

## Table of contents
* [Overview](#overview)
* [Getting Started](#getting-started)
* [Hello World! Example](#hello-world-example)
* [Mojit Lifecycle](#mojit-lifecycle)
* [Configuration](#configuration)
* [API](#api)
* [Architecture](#architecture-diagrams)

## Overview

### Features
* Reduces time to first/last byte
* Supports client-side disabled JavaScript
* Supports [Shaker](https://developer.yahoo.com/cocktails/shaker/) (automatically minifies/combines css/js assets)
* Allows full control of mojit execution stages
* Client/server side event subscription
* Error/timeout handling and reporting
* Easy to use, just requires a simple [configuration](#configuration), and the use of [pipeline.push](#api-push) and [pipeline.close](#api-close)


### How it works

Pipeline consists of three components:

* [**Pipeline Frame**](https://github.com/yahoo/mojito-pipeline/tree/master/mojits/PipelineFrame): The [PipelineFrame](https://github.com/yahoo/mojito-pipeline/tree/master/mojits/PipelineFrame), or the Shaker equivalent [ShakerPipelineFrame](https://github.com/yahoo/mojito-pipeline/tree/master/mojits/ShakerPipelineFrame), is a frame mojit, similar to Mojito's [HTMLFrameMojit](https://developer.yahoo.com/cocktails/mojito/docs/topics/mojito_frame_mojits.html). It accepts one root level mojit, which it surrounds with a full html page frame, including `html`, `head`, and `body` tags. It is responsible for embedding the PipelineClient (see [below](#pipeline-client)), and periodically flushing content to the client, including css/js assets. It accepts a configuration consisting of a tree of mojits that can appear on the page (see [configuration](#configuration)).

* [**Pipeline Addon**](https://github.com/yahoo/mojito-pipeline/tree/master/addons/ac/pipeline.server.js): The Pipeline addon implements [Pipeline's api](#api), which allows users to [push](#api-push) mojits, [close](#api-close) the pipeline, and [subscribe to events](#api-on). It is responsible for processing mojits throughout their various stages (see [mojit lifecycle](#mojit-lifecycle)), while allowing concurrency between data retrieval, mojit execution, and the flushing of content.

* [**Pipeline Client**](https://github.com/yahoo/mojito-pipeline/blob/master/assets/void/pipeline-client.js): The Pipeline client handles the displaying of mojits on the client side. It is minified and inline on the first flush to the client. The Pipeline client consist of a global `pipeline` object, which is used to deserialize flushed mojits and display them, observing any user defined displaying rules.


## Getting Started

mojito-pipeline requires a Mojito application (Take a look at the [Mojito Quickstart](https://developer.yahoo.com/cocktails/mojito/docs/getting_started/quickstart.html))

1. Install mojito-pipeline in the Mojito application:

        $ npm install mojito-pipeline

2. Recommended. Install mojito-shaker ([Shaker](https://developer.yahoo.com/cocktails/shaker/) automatically processes assets):

	    $ npm install mojito-shaker

3. Add or modify a route's configuration to use the `PipelineFrame` or `ShakerPipelineFrame` (see [configuration](#configuration)).

4. Push mojits into the pipeline using [ac.pipeline.push](#api-push).

5. Close the pipeline using [ac.pipeline.close](#api-close), after all mojits have been pushed.

Take a look at the ["Hello World! example"](#hello-world-example) below.

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
			'mojito-pipeline-addon'
		]
	});
	```
	
	**mojits/Root/views/index.hb.html**
	```html
	<div>
		{{{hello}}}
	</div>
	```
	
	The `Root` controller simply pushes its only child mojit, reference by its `hello` id. It then closes the pipeline and passes its children data to its view. As specified in the configuration above, the top level mojit is of type `Root`, which automatically gets pushed to the pipeline. Pipeline always refers to the top level mojit as `root`. Before `root` is dispatched, Pipeline populates its `params.body.children` with the rendered data of its children. In this case `root` only has one child, `hello`, which hasn't been rendered so `ac.params.body().children.hello` is equal to `<div id="hello-section"></div>`. This is a placeholder for the `hello` child, which Pipeline will fill, whenever `hello` is fully rendered, either before rendering `root` or on the client side.


## Mojit Lifecycle

After being pushed into the pipeline, mojits undergo various stages before finally being displayed on the client. Pipeline is fully responsible for processing mojits along these stages, but also allows users to precisely control and hook into mojit execution through [execution rules](#stage-action-rules) and [event subscription](#api-on).

Stage Action | Resulting State   | Description 
-------------|-------------------|----------------------------------------------------------------------------
push         | `pushed`          | The mojit has just been pushed using [ac.pipeline.push](#api-push).
dispatch     | `dispatched`      | The mojit's controller has been called.
render       | `rendered`        | The data passed to ac.done has been used to render the mojit's view.
flush        | `flushed`         | The mojit has been added to the flush queue and will be sent to the client.
display      | `displayed`       | The mojit has been displayed on the client side.


**Exception States**

Exception | Resulting State   | Description
----------|-------------------|-------------------------------------------------------------------------------
timeout   | `timedout`        | The mojit timed out after dependencies prevented it from being dispatched.
error     | `errored`         | There was an error while dispatching the mojit or its error rule returned true.


## Configuration

### Application Specs

A Mojito route that is handled by Pipeline requires an application specs entry that makes use of the `PipelineFrame` mojit, or its Shaker equivalent, `ShakerPipelineFrame`. This entry is a regular mojit spec, requiring `type` to be either `PipelineFrame` or `ShakerPipelineFrame`, and a `config` object:

**Pipeline Frame Config Object**

Property         | Requirement                   | Description
-----------------|-------------------------------|------------------------------------------------------------------------
`child`          | Required                      | The top level mojit, which Pipeline should automatically push.
`deploy`         | Optional, defaults to false   | Whether to deploy the mojito client (see [Deploying to Client](https://developer.yahoo.com/cocktails/mojito/docs/topics/mojito_frame_mojits.html#deploying-to-client)).
`pipelineClient` | Optional, defaults to true    | Whether to use the pipeline client, if false then the page is flushed all at once.

### Mojit Specs

Mojit specs are defined either under Pipeline specs in application.json, or using [ac.pipeline.push](#api-push) at runtime. These specs are regular [Mojito mojit specs](https://developer.yahoo.com/cocktails/mojito/docs/intro/mojito_configuring.html#specs-object) and can include the following optional Pipeline specific properties:

Property      | Requirement                 | Description
--------------|-----------------------------|------------------------------------------------------------------------------
`id`          | Optional                    | Only used when pushing a mojit to pipeline; refers to a previously defined mojit.
`children`    | Optional                    | A recursive mapping of child id's to mojit specs. Note id's must be unique.
`autoPush`    | Optional, defaults to false | Whether to push this mojit automatically after its parent has been pushed.
`blockParent` | Optional, defaults to false | Whether to block the parent's dispatching until this mojit has been rendered.

It can also include optional properties that allow precise control over the mojit's flow through its [execution stages](#mojit-lifecycle)):

#### Stage Action Rules

Property   | Description
-----------|---------------------------------------------------------------------------------------------------------------
`dispatch` | When to execute the controller. Can ensure certain children mojits have reach certain states.
`render`   | When to render the view with the given data. Can ensure children mojits are embeded in mojit's view.
`flush`    | When to add the mojit to the flush queue. Can control when the mojit can be flushed to the page.
`display`  | When to display the mojit on the client. Can make sure the mojit is only seen after other mojits.
`error`    | When to error out the mojit. Allows the mojit to reach the error state given a specified condition.

Stage action rules are boolean expressions that are evaluated during runtime, right before the specified stage action. Each clause is composed of a mojit instance and its state, for example, `mojit-id.dispatched`. Clauses can be combined in complex manners using operands such as `&&`, `||`, and parentheses.

**Example**
```js
...
    "dispatch": "(myparent.flushed && child1.rendered) || pipeline.closed)"
...
```
In this example the mojit will only be dispatched after `myparent` has been flushed and `child1` has been rendered, or the pipeline has been closed. Note that `pipeline` refers to the pipeline itself, and only can reach one state, `closed`. `pipeline` is a reserved id in Pipeline.

### Example application.json

```js
{
	"settings": ["master"]
	"specs": {
		"main": {
			"type": "PipelineFrame",
			"deploy": true,
			"pipelineClient": true,
			"child": {
				"type": "Main",
				"children": {
					"child1": {
						"type": "Child",
						"chlildren": {
						    "grandChild1": {
						        "type": "Child", 
						        "autoPush": true,
						        "blockParent": true
					        }
						}
					},
					"child2": {
						"base": "child2",
						"display": "child1.displayed"
					}
				}
			}
		}
	}
}
```

## API

### Accessing Children

Before dispatching a mojit, Pipeline passes the mojit's children's data through `ac.params.body().children`. The mojit is responsible for passing the children to its own view; this allows the mojit to process the children if necessary. Each child object contains the child's reached states, and a `toString` method, which returns the html. Note that individual child objects should not be modified, since they are used internally by Pipeline.

**Note**: Unless a child's html needs to be modified, it is unnecessary to call a child object's `toString` method since the rendering engine automatically calls `toString` on objects before rendering a view. Also calling `toString` method of an unrendered mojit results in a placeholder div, forcing the mojit to be flushed separetely from its parent and be embedded on the client side.

**Example Controller**

```js
...
var body = ac.params.body(),
    children = body.children;
    
if (children.child1.errored) {
    children.child1 = '<span>Error:</span>' + children.child1.toString();
else {
    children.child1 = '<span>Success:</span>' + children.child1.toString();
}

ac.done(Y.mix(viewData, children));
...
```

### Pipeline Addon

<a name="api-push">**ac.pipeline.push**</a> (specs) `async`
Pushes a mojit into the pipeline, allowing pipeline to process the mojit through its [execution stages](#mojit-lifecycle). Note that this method is asynchronous; this allows multiple consecutive calls to ac.pipeline.push, before Pipeline actually starts processing the mojits.
* **specs** `object` | `string` - A mojit specs object (see [mojit specs](#mojit-specs)); the `id` property should be specified when referring to a previously defined mojit specs, in which case the new specs will be mixed with the old specs, with the new specs taking precedence. This method also accepts a string, corresponding to the id of a previously defined mojit specs.
* **returns** `string` - The pushed mojit's id. This id may be a generated id, if the mojit specs pushed did not specify one.

**Example**
```
ac.pipeline.push('mymojit1');

ac.pipeline.push({
    id: 'mymojit2',
    config: {
        runtimeConfig: runtimeConfig
    }
});
```

---

<a name="api-close">**ac.pipeline.close**</a> (specs)
Closes the pipeline, signaling that no more mojits will be pushed. Note that the pipeline `onClose` event is fired after Pipeline finishes processing all the mojits that have been pushed (see [event actions](#event-actions)).

**Example**
```
ac.pipeline.close();
```

---

<a name="api-on">**ac.pipeline.on**</a> (subject, action, callback)
Subscribes to a subject-action event, triggering a callback everytime the specified subject receives the specified action.
* subject `string` - The subject (either 'pipeline' or a mojit's id) that received the specified action. If '*' is specified then any subject is used.
* action `string` - The action applied to the subject (see [event actions](#event-actions) below).
* callback(event, data) `function` - The callback function that is called after the event is triggered. The callback has two arguments: an event object (see [event object](#event-object) below), and any data associated with the event (see [event actions](#event-actions) below). Note this callback is called every time the event is triggered; to limit the triggering to only once use [ac.pipeline.once](#api-once).
* returns subscription `object` - A subscription to the event, includes the method `unsubscribe` to stop listening to the event.

### Event Actions

Event                  | Event Type | Data               | Description
-----------------------|------------|--------------------|-----------------------------------------------------------------
`before/afterDispatch` | Mojit      | Mojit Object       | Fired before/after dispatching a mojit.
`before/afterRender`   | Mojit      | Mojit Object       | Fired before/after rendering a mojit.
`before/afterFlush`    | Mojit      | Mojit Object       | Fired before/after placing a mojit in flush queue.
`onError`              | Mojit      | Mojit Object       | Fired once a mojit has reached an error.
`onTimeout`            | Mojit      | Mojit Object       | Fired once a mojit has timed out.
`on/afterClose`        | Pipeline   | N/A                | Fired once Pipeline finishes processing mojits, and after it has checked for any errors.
`beforeFlush`          | Pipeline   | Mojit Object       | Fired before Pipeline flushes the flush queue.
`onError`              | Pipeline   | Mojit Object Array | Fired after closing and determining that there were errors, passes errored mojits.

### Event Object

Property | Description
---------|------------------------------------------------------------
target   | The subject that received the event's corresponding action.
action   | The action that the target received.


**Example**

```js
ac.pipeline.on('*', 'afterRender', function (event, mojit) {
    console.log(event.target + ' has been rendered: ' + mojit.toString());
});
```

---

<a name="api-once">**ac.pipeline.once**</a> (subject, action, callback)
Same as [ac.pipeline.on](#api-on), except the subscription is unsubscribed after the first call to the callback.

## Architecture Diagrams

### Execution Flow

[![Architecture 1](https://github.com/yahoo/mojito-pipeline/raw/master/images/architecture1.png)](https://github.com/yahoo/mojito-pipeline/raw/master/images/architecture1.png)

[![Architecture 2](https://github.com/yahoo/mojito-pipeline/raw/master/images/architecture2.png)](https://github.com/yahoo/mojito-pipeline/raw/master/images/architecture2.png)
