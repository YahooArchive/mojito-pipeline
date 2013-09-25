#mojito-pipeline
Mojito-pipeline allows a mojito app to selectively schedule the rendering, the streaming, and the displaying of mojits (sections) of the page from the server to, and on, the client (browser). It leverages Node's event-oriented architecture to let you push those sections as their data comes from the backend; it handles structural dependencies, custom programmatic dependencies, errors and timeouts; and it gives you a lot of power to manage the lifecycle of your sections.

#Table of contents
* [Terminology](https://github.com/yahoo/mojito-pipeline#terminology)
* [Example](https://github.com/yahoo/mojito-pipeline#example)
* [API Doc](https://github.com/yahoo/mojito-pipeline#api-doc)
* [Code Structure](https://github.com/yahoo/mojito-pipeline#code-structure)

#Terminology
###task
a pipeline internal object that represents the scheduled runtime of a mojit instance and is created with a mojit configuration pushed in the pipeline by the user
###section
a child task that can be replaced by a stub and asynchronously streamed to the browser when it's available (in the example below, the ads are sections)
###dependency
a child task which needs to be blocking the parent task (often in order to be process by it, for example bolding or counting search results)
###default section
a child section that the parent should push automatically
###`'rendered'`, `'flushed'`, `'displayed'`, `'errored'`, `'timedOut'`
members of a task object that describe a task state and are modified throughout its lifecycle
###`'render'`, `'flush'`, `'display'`, `'error'`, `'timeout'`
task actions which can be triggered under certain conditions defined by a boolean expression of other task states

#Example
```yaml
# application.yaml
[
    {
        "settings": [ "master" ],
        # ...
        "specs": {
            "rootframe": {
                "type": "SearchHTMLFrame",
                "config": {
                    "deploy": true,
                    "pipeline": true,
                    "child": {
                        "type": "Master",
                        "sections": {
                            "search-box": {
                                "type": "Box",
                                "default": true,
                                "config": {
                                    "title": "Search Box"
                                }
                            },
                            "search-results": {
                                "type": "SearchResults"
                            },
                            "ads": {
                                "type": "Ads",
                                "render": "search-results.rendered",
                                "sections": {
                                    "north-ad": {
                                        "type": "Box"
                                    },
                                    "south-ad": {
                                        "type": "Box"
                                    }
                                }
                            },
                            "footer": {
                                "type": "Box",
                                "flush": "pipeline.closed",
                                "default": true,
                                "config": {
                                    "title": "footer"
                                }
                            }
                        }
                    }
                }
            }
        },
            # ...
    }
]
```
```javascript
// Master/Parent Controller
Y.namespace('mojito.controllers')[NAME] = {

    index: function (ac) {

        backend.getData(function (dataBit) {
            // this function is invoked for each data bit received
            var runtimeTaskConfig;

            if (!dataBit) {
                return ac.pipeline.close();
            }

            runtimeTaskConfig = makeTaskConfig(dataBit);
            ac.pipeline.push(runtimeTaskConfig);
        });

        ac.done(ac.params.body('children'));
    }
};
```
In the code above, you can see an number of arbitrary variables that are hopefully self-explanatory. One of them, `makeTaskConfig` represents a function that generates a task configuration with the data returned by the backend. This configuration and the one you can find in application.yaml are documented in the API Doc section below.

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
