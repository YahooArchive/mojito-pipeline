/*jslint anon:true, sloppy:true, nomen:true*/
/*global YUI*/
YUI.add('PipelineHTMLFrameMojit', function (Y, NAME) {
    'use strict';

    Y.namespace('mojito.controllers')[NAME] = {

        index: function (ac) {
            var frameClosed = false,
                self = this,
                root = ac.config.get('root'),
                rootTask = new ac.pipeline.Task({
                    id: 'root',
                    type: root.type,
                    flushTest: function () {
                        return false;
                    },
                    afterRender: function (rootHTML, meta) {
                        self.flushFrame(ac, rootHTML, meta);
                    }
                });

            ac.pipeline.push(rootTask);

            /*

            Pipeline should handle this automatically

            // if this is pipe's last flush, append html end tag
            ac.pipeline.beforeFlush(function (flushData) {
                if (ac.pipeline.closed) {
                    flushData += '</html>';
                    frameClosed = true;
                    ac.done();
                }
            });
            // if pipe is closed after sending last flush, send html end tag
            ac.pipeline.onClose(function () {
                if (!flameClosed) {
                    ac.done('</html>');
                }
            });*/

        },

        flushFrame: function (ac, rootHTML, meta) {
            // meta.assets from child should be piped into
            // the frame's assets before doing anything else.
            ac.assets.addAssets(meta.assets);

            if (ac.config.get('deploy') === true) {
                ac.deploy.constructMojitoClientRuntime(ac.assets,
                    meta.binders);
            }

            // we don't care much about the views specified in childs
            // and for the parent, we have a fixed one.
            meta.view = {
                name: 'index'
            };

            // 1. mixing bottom and top fragments from assets into
            //    the template data, along with title and mojito version.
            // 2. mixing meta with child metas, along with some extra
            //    headers.
            ac.done(
                Y.merge(ac.pipeline.htmlData, ac.assets.renderLocations(), {
                    end: !ac.pipeline.client.jsEnabled || ac.pipeline.closed ? '</html>' : ''
                }, {

                    title: ac.config.get('title') || 'Powered by Mojito Pipeline',
                    mojito_version: Y.mojito.version

                }),
                Y.mojito.util.metaMerge(meta, {

                    http: {
                        headers: {
                            'content-type': 'text/html; charset="utf-8"'
                        }
                    }

                }, true)
            );
        }
    };

}, '0.1.0', {requires: [
    'mojito',
    'mojito-util',
    'mojito-assets-addon',
    'mojito-deploy-addon',
    'mojito-config-addon',
    'mojito-pipeline-addon'
]});
