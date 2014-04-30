/*
 * Copyright (c) 2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

/*jslint nomen:true, plusplus:true */
/*global YUI */

if (typeof YUI === 'function') {
    // Making sure the PipelineFrame controller is available to this module if lazyMojits is on.
    YUI().applyConfig({
        modules: {
            PipelineFrameMojit: {
                fullpath: require('path').join(__dirname, '../PipelineFrame/controller.server.js')
            }
        }
    });
}

YUI.add('ShakerPipelineFrameMojit', function (Y, NAME) {
    'use strict';

    var PipelineFrameMojit = Y.mojito.controllers.PipelineFrameMojit;

    // Inherit methods from the PipelineFrameMojit and override
    // to add Shaker specific functionality.
    Y.mojito.controllers[NAME] = Y.merge(PipelineFrameMojit, {

        _init: function (ac) {
            // Serves as a queue, to delay the rendering of postfetch assets
            // until the last flush.
            this.postfetch = {
                js: [],
                css: [],
                blob: []
            };

            PipelineFrameMojit._init.apply(this, arguments);

            if (!ac.pipeline.client.jsEnabled) {
                ac.shaker.set('serveJs', false);
            }

            // Use the shaker htmlData as the view data so that this
            // frame's view data can be manipulated through Shaker's APIs.
            this.view = ac.shaker.data.htmlData;
        },

        _render: function (callback) {
            var ac = this.ac,
                meta = this.meta;

            // Add top rollups, app resources, and filter assets.
            ac.shaker._addRouteRollups(meta.assets, ['top', 'shakerTop']);
            ac.shaker._addAppResources(meta.assets);
            ac.shaker._filterAndUpdate(meta.assets);

            PipelineFrameMojit._render.apply(this, arguments);
        },

        _processMeta: function (meta) {
            var postfetch = this.postfetch;

            PipelineFrameMojit._processMeta.apply(this, arguments);

            // Queue up postfetch assets such that the are added only on the last flush.
            Y.Object.each(meta.assets.postfetch, function (typeAssets, type) {
                Array.prototype.push.apply(postfetch[type], typeAssets);
            });

            delete meta.assets.postfetch;
        },

        _addMojitoClient: function (meta) {
            var ac = this.ac,
                binders = this.binders,
                postfetch = this.postfetch;

            if (ac.pipeline.closed && ac.pipeline.client.jsEnabled) {
                // Force the mojito client to be place on the bottom.
                ac.shaker.set('serveJs', {
                    position: 'bottom'
                });

                // Add bottom rollups, mojito client runtime, and bootstrap.
                ac.shaker._addRouteRollups(meta.assets, ['bottom']);
                ac.shaker._addYUILoader(meta.assets, binders);
                ac.shaker._addBootstrap(meta.assets);

                // Add any postfetch assets that has been queued.
                Y.mojito.util.metaMerge(meta.assets, {
                    'postfetch': postfetch
                });
            }
        },

        _wrapFlushData: function (flushData) {
            // Filter assets before they are wrapped.
            this.ac.shaker._filterAndUpdate(flushData.meta.assets);
            PipelineFrameMojit._wrapFlushData.apply(this, arguments);
        },

        _concatRenderedAssets: function (renderedAsset, renderedAssets, location, type) {
            var ac = this.ac;

            // Add postfetch and assets below shakerTop to the bottom, and the rest to the top
            if (location === 'postfetch' || ac.shaker.PAGE_POSITIONS.indexOf(location) > 2) {
                renderedAssets.bottom  += renderedAsset;
            } else {
                renderedAssets.top += renderedAsset;
            }
        }
    });

}, '0.1.0', {
    requires: [
        'mojito',
        'mojito-util',
        'mojito-assets-addon',
        'mojito-http-addon',
        'mojito-deploy-addon',
        'mojito-config-addon',
        'mojito-shaker-addon',
        'mojito-pipeline-addon',
        'PipelineFrameMojit'
    ]
});
