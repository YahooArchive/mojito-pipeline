#mojito-pipeline
mojito-pipeline allows a mojito app to selectively schedule the rendering, the streaming and the displaying of mojits/sections of the page from the server to and on the client/browser. It leverages node's event-oriented architecture to let you push those sections as their data comes from the backend and handles structural dependencies, custom programmatic dependencies, errors and timeouts, and gives you a lot of power to manage the lifecycle of your sections.

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

#Lifecycle of a task
Inside the pipeline, the task goes through a series of stages that eventually lead to its displaying in the client's browser. 
