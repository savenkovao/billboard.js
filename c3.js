/**
 * c3.core.js
 */
(function (window) {
    'use strict';

    /*global define, module, exports, require */

    var c3 = { version: "0.3.0" };

    // will be called to generate c3 chart object
    c3.generate = function (config) {
        return new c3_chart(config);
    };

    // c3.fn.$$ and c3.fn.chart will be defined as prototype interface
    c3.fn = {};

    /*-- HIDDEN VARS AND FUNCTIONS --*/

    // Define solid chart for hiding its functions from chart object scope
    var chart = function () {};

    // Wrap solid chart object and call functions defined through c3.fn.$$ and c3.fn.chart
    var c3_chart = function (config) {

        var $$ = this.$$ = new chart(),
            d3 = $$.d3 = window.d3 ? window.d3 : 'undefined' !== typeof require ? require("d3") : undefined;

        $$.this = this;
        $$.config = config;
        $$.data = {};
        $$.cache = {};

        /*-- Handle Config --*/

        $$.updateConfig();

        // TODO: this should be an API
        this.config = config;

        /*-- Set Variables --*/

        // TODO: some of these should be a function and defined in prototype

        // MEMO: clipId needs to be unique because it conflicts when multiple charts exist
        $$.clipId = "c3-" + (+new Date()) + '-clip',
        $$.clipIdForXAxis = $$.clipId + '-xaxis',
        $$.clipIdForYAxis = $$.clipId + '-yaxis',
        $$.clipPath = $$.getClipPath($$.clipId),
        $$.clipPathForXAxis = $$.getClipPath($$.clipIdForXAxis),
        $$.clipPathForYAxis = $$.getClipPath($$.clipIdForYAxis);

        $$.isTimeSeries = ($$.__axis_x_type === 'timeseries');
        $$.isCategorized = ($$.__axis_x_type.indexOf('categor') >= 0);
        $$.isCustomX = function () { return !$$.isTimeSeries && ($$.__data_x || $$.notEmpty($$.__data_xs)); };

        $$.dragStart = null;
        $$.dragging = false;
        $$.cancelClick = false;
        $$.mouseover = false;
        $$.transiting = false;

        $$.defaultColorPattern = d3.scale.category10().range();
        $$.color = $$.generateColor($$.__data_colors, $$.notEmpty($$.__color_pattern) ? $$.__color_pattern : $$.defaultColorPattern, $$.__data_color);
        $$.levelColor = $$.notEmpty($$.__color_threshold) ? $$.generateLevelColor($$.__color_pattern, $$.__color_threshold) : null;

        $$.dataTimeFormat = $$.__data_x_localtime ? d3.time.format : d3.time.format.utc;
        $$.axisTimeFormat = $$.__axis_x_localtime ? d3.time.format : d3.time.format.utc;
        $$.defaultAxisTimeFormat = $$.axisTimeFormat.multi([
            [".%L", function (d) { return d.getMilliseconds(); }],
            [":%S", function (d) { return d.getSeconds(); }],
            ["%I:%M", function (d) { return d.getMinutes(); }],
            ["%I %p", function (d) { return d.getHours(); }],
            ["%-m/%-d", function (d) { return d.getDay() && d.getDate() !== 1; }],
            ["%-m/%-d", function (d) { return d.getDate() !== 1; }],
            ["%-m/%-d", function (d) { return d.getMonth(); }],
            ["%Y/%-m/%-d", function () { return true; }]
        ]);

        $$.hiddenTargetIds = [];
        $$.hiddenLegendIds = [];

        $$.axes = {};

        $$.xOrient = $$.__axis_rotated ? "left" : "bottom";
        $$.yOrient = $$.__axis_rotated ? ($$.__axis_y_inner ? "top" : "bottom") : ($$.__axis_y_inner ? "right" : "left");
        $$.y2Orient = $$.__axis_rotated ? ($$.__axis_y2_inner ? "bottom" : "top") : ($$.__axis_y2_inner ? "left" : "right");
        $$.subXOrient = $$.__axis_rotated ? "left" : "bottom";

        $$.translate = {
            main : function () { return "translate(" + $$.asHalfPixel($$.margin.left) + "," + $$.asHalfPixel($$.margin.top) + ")"; },
            context : function () { return "translate(" + $$.asHalfPixel($$.margin2.left) + "," + $$.asHalfPixel($$.margin2.top) + ")"; },
            legend : function () { return "translate(" + $$.margin3.left + "," + $$.margin3.top + ")"; },
            x : function () { return "translate(0," + ($$.__axis_rotated ? 0 : $$.height) + ")"; },
            y : function () { return "translate(0," + ($$.__axis_rotated ? $$.height : 0) + ")"; },
            y2 : function () { return "translate(" + ($$.__axis_rotated ? 0 : $$.width) + "," + ($$.__axis_rotated ? 1 : 0) + ")"; },
            subx : function () { return "translate(0," + ($$.__axis_rotated ? 0 : $$.height2) + ")"; },
            arc: function () { return "translate(" + ($$.arcWidth / 2) + "," + ($$.arcHeight / 2) + ")"; }
        };

        $$.isLegendRight = $$.__legend_position === 'right';
        $$.isLegendInset = $$.__legend_position === 'inset';
        $$.isLegendTop = $$.__legend_inset_anchor === 'top-left' || $$.__legend_inset_anchor === 'top-right';
        $$.isLegendLeft = $$.__legend_inset_anchor === 'top-left' || $$.__legend_inset_anchor === 'bottom-left';
        $$.legendStep = 0;
        $$.legendItemWidth = 0;
        $$.legendItemHeight = 0;
        $$.legendOpacityForHidden = 0.15;

        $$.currentMaxTickWidth = 0;

        $$.rotated_padding_left = 30;
        $$.rotated_padding_right = $$.__axis_rotated && !$$.__axis_x_show ? 0 : 30;
        $$.rotated_padding_top = 5;

        $$.withoutFadeIn = {};

        // TODO: this should be pluggable
        $$.pie = d3.layout.pie().value(function (d) {
            return d.values.reduce(function (a, b) { return a + b.value; }, 0);
        });
        if (!$$.__pie_sort || !$$.__donut_sort) { // TODO: this needs to be called by each type
            $$.pie.sort(null);
        }

        // TODO: this should be pluggable
        $$.brush = d3.svg.brush().on("brush", $$.redrawForBrush);
        $$.brush.update = function () {
            if ($$.context) { $$.context.select('.' + this.CLASS.brush).call(this); }
            return this;
        };
        $$.brush.scale = function (scale) {
            return $$.__axis_rotated ? this.y(scale) : this.x(scale);
        };

        // TODO: this should be pluggable
        $$.zoom = d3.behavior.zoom()
            .on("zoomstart", function () {
                $$.zoom.altDomain = d3.event.sourceEvent.altKey ? $$.x.orgDomain() : null;
            })
            .on("zoom", $$.redrawForZoom);
        $$.zoom.scale = function (scale) {
            return $$.__axis_rotated ? this.y(scale) : this.x(scale);
        };
        $$.zoom.orgScaleExtent = function () {
            var extent = $$.__zoom_extent ? $$.__zoom_extent : [1, 10];
            return [extent[0], Math.max(this.getMaxDataCount() / extent[1], extent[1])];
        };
        $$.zoom.updateScaleExtent = function () {
            var ratio = this.diffDomain($$.x.orgDomain()) / this.diffDomain(this.orgXDomain), extent = this.orgScaleExtent();
            this.scaleExtent([extent[0] * ratio, extent[1] * ratio]);
            return this;
        };

        /*-- Load data and init chart with defined functions --*/

        if (config.data.url) {
            $$.convertUrlToData(config.data.url, config.data.mimeType, config.data.keys, $$.init);
        }
        else if (config.data.json) {
            $$.init($$.convertJsonToData(config.data.json, config.data.keys));
        }
        else if (config.data.rows) {
            $$.init($$.convertRowsToData(config.data.rows));
        }
        else if (config.data.columns) {
            $$.init($$.convertColumnsToData(config.data.columns));
        }
        else {
            throw Error('url or json or rows or columns is required.');
        }
    };

    // Open interface for each prototype
    c3.fn.chart = c3_chart.prototype = {};
    c3.fn.$$ = chart.prototype = {};

    if (typeof define === "function" && define.amd) {
        define("c3", ["d3"], c3);
    } else if ('undefined' !== typeof exports && 'undefined' !== typeof module) {
        module.exports = c3;
    } else {
        window.c3 = c3;
    }

})(window);



// TODO: these should be separated into each file
(function (c3) {
    'use strict';

    /**
     *  c3.config.js
     */
    c3.fn.$$.getConfig = function (keys, defaultValue) {
        var target = this.config, i, isLast, nextTarget;
        for (i = 0; i < keys.length; i++) {
            // return default if key not found
            if (typeof target === 'object' && !(keys[i] in target)) { return defaultValue; }
            // Check next key's value
            isLast = (i === keys.length - 1);
            nextTarget = target[keys[i]];
            if (!isLast && typeof nextTarget !== 'object') {
                return defaultValue;
            }
            target = nextTarget;
        }
        return target;
    };
    c3.fn.$$.updateConfig = function () {
        var $$ = this;

        $$.__bindto = $$.getConfig(['bindto'], '#chart');

        $$.__size_width = $$.getConfig(['size', 'width']);
        $$.__size_height = $$.getConfig(['size', 'height']);

        $$.__padding_left = $$.getConfig(['padding', 'left']);
        $$.__padding_right = $$.getConfig(['padding', 'right']);
        $$.__padding_top = $$.getConfig(['padding', 'top']);
        $$.__padding_bottom = $$.getConfig(['padding', 'bottom']);

        $$.__zoom_enabled = $$.getConfig(['zoom', 'enabled'], false);
        $$.__zoom_extent = $$.getConfig(['zoom', 'extent']);
        $$.__zoom_privileged = $$.getConfig(['zoom', 'privileged'], false);
        $$.__zoom_onzoom = $$.getConfig(['zoom', 'onzoom'], function () {});

        $$.__interaction_enabled = $$.getConfig(['interaction', 'enabled'], true);

        $$.__onmouseover = $$.getConfig(['onmouseover'], function () {});
        $$.__onmouseout = $$.getConfig(['onmouseout'], function () {});
        $$.__onresize = $$.getConfig(['onresize'], function () {});
        $$.__onresized = $$.getConfig(['onresized'], function () {});

        $$.__transition_duration = $$.getConfig(['transition', 'duration'], 350);

        $$.__data_x = $$.getConfig(['data', 'x']);
        $$.__data_xs = $$.getConfig(['data', 'xs'], {});
        $$.__data_x_format = $$.getConfig(['data', 'x_format'], '%Y-%m-%d');
        $$.__data_x_localtime = $$.getConfig(['data', 'x_localtime'], true);
        $$.__data_id_converter = $$.getConfig(['data', 'id_converter'], function (id) { return id; });
        $$.__data_names = $$.getConfig(['data', 'names'], {});
        $$.__data_classes = $$.getConfig(['data', 'classes'], {});
        $$.__data_groups = $$.getConfig(['data', 'groups'], []);
        $$.__data_axes = $$.getConfig(['data', 'axes'], {});
        $$.__data_type = $$.getConfig(['data', 'type']);
        $$.__data_types = $$.getConfig(['data', 'types'], {});
        $$.__data_labels = $$.getConfig(['data', 'labels'], {});
        $$.__data_order = $$.getConfig(['data', 'order']);
        $$.__data_regions = $$.getConfig(['data', 'regions'], {});
        $$.__data_color = $$.getConfig(['data', 'color']);
        $$.__data_colors = $$.getConfig(['data', 'colors'], {});
        $$.__data_hide = $$.getConfig(['data', 'hide'], false);
        $$.__data_filter = $$.getConfig(['data', 'filter']);
        $$.__data_selection_enabled = $$.getConfig(['data', 'selection', 'enabled'], false);
        $$.__data_selection_grouped = $$.getConfig(['data', 'selection', 'grouped'], false);
        $$.__data_selection_isselectable = $$.getConfig(['data', 'selection', 'isselectable'], function () { return true; });
        $$.__data_selection_multiple = $$.getConfig(['data', 'selection', 'multiple'], true);
        $$.__data_onclick = $$.getConfig(['data', 'onclick'], function () {});
        $$.__data_onmouseover = $$.getConfig(['data', 'onmouseover'], function () {});
        $$.__data_onmouseout = $$.getConfig(['data', 'onmouseout'], function () {});
        $$.__data_onselected = $$.getConfig(['data', 'onselected'], function () {});
        $$.__data_onunselected = $$.getConfig(['data', 'onunselected'], function () {});
        $$.__data_ondragstart = $$.getConfig(['data', 'ondragstart'], function () {});
        $$.__data_ondragend = $$.getConfig(['data', 'ondragend'], function () {});

        // configuration for no plot-able data supplied.
        $$.__data_empty_label_text = $$.getConfig(['data', 'empty', 'label', 'text'], "");
        
        // subchart
        $$.__subchart_show = $$.getConfig(['subchart', 'show'], false);
        $$.__subchart_size_height = $$.getConfig(['subchart', 'size', 'height'], 60);
        $$.__subchart_onbrush = $$.getConfig(['subchart', 'onbrush'], function () {});

        // color
        $$.__color_pattern = $$.getConfig(['color', 'pattern'], []);
        $$.__color_threshold  = $$.getConfig(['color', 'threshold'], {});

        // legend
        $$.__legend_show = $$.getConfig(['legend', 'show'], true);
        $$.__legend_position = $$.getConfig(['legend', 'position'], 'bottom');
        $$.__legend_inset_anchor = $$.getConfig(['legend', 'inset', 'anchor'], 'top-left');
        $$.__legend_inset_x = $$.getConfig(['legend', 'inset', 'x'], 10);
        $$.__legend_inset_y = $$.getConfig(['legend', 'inset', 'y'], 0);
        $$.__legend_inset_step = $$.getConfig(['legend', 'inset', 'step']);
        $$.__legend_item_onclick = $$.getConfig(['legend', 'item', 'onclick']);
        $$.__legend_item_onmouseover = $$.getConfig(['legend', 'item', 'onmouseover']);
        $$.__legend_item_onmouseout = $$.getConfig(['legend', 'item', 'onmouseout']);
        $$.__legend_equally = $$.getConfig(['legend', 'equally'], false);

        // axis
        $$.__axis_rotated = $$.getConfig(['axis', 'rotated'], false);
        $$.__axis_x_show = $$.getConfig(['axis', 'x', 'show'], true);
        $$.__axis_x_type = $$.getConfig(['axis', 'x', 'type'], 'indexed');
        $$.__axis_x_localtime = $$.getConfig(['axis', 'x', 'localtime'], true);
        $$.__axis_x_categories = $$.getConfig(['axis', 'x', 'categories'], []);
        $$.__axis_x_tick_centered = $$.getConfig(['axis', 'x', 'tick', 'centered'], false);
        $$.__axis_x_tick_format = $$.getConfig(['axis', 'x', 'tick', 'format']);
        $$.__axis_x_tick_culling = $$.getConfig(['axis', 'x', 'tick', 'culling'], {});
        $$.__axis_x_tick_culling_max = $$.getConfig(['axis', 'x', 'tick', 'culling', 'max'], 10);
        $$.__axis_x_tick_count = $$.getConfig(['axis', 'x', 'tick', 'count']);
        $$.__axis_x_tick_fit = $$.getConfig(['axis', 'x', 'tick', 'fit'], true);
        $$.__axis_x_tick_values = $$.getConfig(['axis', 'x', 'tick', 'values'], null);
        $$.__axis_x_tick_rotate = $$.getConfig(['axis', 'x', 'tick', 'rotate']);
        $$.__axis_x_max = $$.getConfig(['axis', 'x', 'max'], null);
        $$.__axis_x_min = $$.getConfig(['axis', 'x', 'min'], null);
        $$.__axis_x_padding = $$.getConfig(['axis', 'x', 'padding'], {});
        $$.__axis_x_height = $$.getConfig(['axis', 'x', 'height']);
        $$.__axis_x_default = $$.getConfig(['axis', 'x', 'default']);
        $$.__axis_x_label = $$.getConfig(['axis', 'x', 'label'], {});
        $$.__axis_y_show = $$.getConfig(['axis', 'y', 'show'], true);
        $$.__axis_y_max = $$.getConfig(['axis', 'y', 'max']);
        $$.__axis_y_min = $$.getConfig(['axis', 'y', 'min']);
        $$.__axis_y_center = $$.getConfig(['axis', 'y', 'center']);
        $$.__axis_y_label = $$.getConfig(['axis', 'y', 'label'], {});
        $$.__axis_y_inner = $$.getConfig(['axis', 'y', 'inner'], false);
        $$.__axis_y_tick_format = $$.getConfig(['axis', 'y', 'tick', 'format']);
        $$.__axis_y_padding = $$.getConfig(['axis', 'y', 'padding']);
        $$.__axis_y_ticks = $$.getConfig(['axis', 'y', 'ticks'], 10);
        $$.__axis_y2_show = $$.getConfig(['axis', 'y2', 'show'], false);
        $$.__axis_y2_max = $$.getConfig(['axis', 'y2', 'max']);
        $$.__axis_y2_min = $$.getConfig(['axis', 'y2', 'min']);
        $$.__axis_y2_center = $$.getConfig(['axis', 'y2', 'center']);
        $$.__axis_y2_label = $$.getConfig(['axis', 'y2', 'label'], {});
        $$.__axis_y2_inner = $$.getConfig(['axis', 'y2', 'inner'], false);
        $$.__axis_y2_tick_format = $$.getConfig(['axis', 'y2', 'tick', 'format']);
        $$.__axis_y2_padding = $$.getConfig(['axis', 'y2', 'padding']);
        $$.__axis_y2_ticks = $$.getConfig(['axis', 'y2', 'ticks'], 10);

        // grid
        $$.__grid_x_show = $$.getConfig(['grid', 'x', 'show'], false);
        $$.__grid_x_type = $$.getConfig(['grid', 'x', 'type'], 'tick');
        $$.__grid_x_lines = $$.getConfig(['grid', 'x', 'lines'], []);
        $$.__grid_y_show = $$.getConfig(['grid', 'y', 'show'], false);
        // not used
        // __grid_y_type = $$.getConfig(['grid', 'y', 'type'], 'tick'),
        $$.__grid_y_lines = $$.getConfig(['grid', 'y', 'lines'], []);
        $$.__grid_y_ticks = $$.getConfig(['grid', 'y', 'ticks'], 10);
        $$.__grid_focus_show = $$.getConfig(['grid', 'focus', 'show'], true);

        // point - point of each data
        $$.__point_show = $$.getConfig(['point', 'show'], true);
        $$.__point_r = $$.getConfig(['point', 'r'], 2.5);
        $$.__point_focus_expand_enabled = $$.getConfig(['point', 'focus', 'expand', 'enabled'], true);
        $$.__point_focus_expand_r = $$.getConfig(['point', 'focus', 'expand', 'r']);
        $$.__point_select_r = $$.getConfig(['point', 'focus', 'select', 'r']);

        $$.__line_connect_null = $$.getConfig(['line', 'connect_null'], false);

        // bar
        $$.__bar_width = $$.getConfig(['bar', 'width']);
        $$.__bar_width_ratio = $$.getConfig(['bar', 'width', 'ratio'], 0.6);
        $$.__bar_zerobased = $$.getConfig(['bar', 'zerobased'], true);

        // area
        $$.__area_zerobased = $$.getConfig(['area', 'zerobased'], true);

        // pie
        $$.__pie_label_show = $$.getConfig(['pie', 'label', 'show'], true);
        $$.__pie_label_format = $$.getConfig(['pie', 'label', 'format']);
        $$.__pie_label_threshold = $$.getConfig(['pie', 'label', 'threshold'], 0.05);
        $$.__pie_sort = $$.getConfig(['pie', 'sort'], true);
        $$.__pie_expand = $$.getConfig(['pie', 'expand'], true);

        // gauge
        $$.__gauge_label_show = $$.getConfig(['gauge', 'label', 'show'], true);
        $$.__gauge_label_format = $$.getConfig(['gauge', 'label', 'format']);
        $$.__gauge_expand = $$.getConfig(['gauge', 'expand'], true);
        $$.__gauge_min = $$.getConfig(['gauge', 'min'], 0);
        $$.__gauge_max = $$.getConfig(['gauge', 'max'], 100);
        $$.__gauge_units = $$.getConfig(['gauge', 'units']);
        $$.__gauge_width = $$.getConfig(['gauge', 'width']);

        // donut
        $$.__donut_label_show = $$.getConfig(['donut', 'label', 'show'], true);
        $$.__donut_label_format = $$.getConfig(['donut', 'label', 'format']);
        $$.__donut_label_threshold = $$.getConfig(['donut', 'label', 'threshold'], 0.05);
        $$.__donut_sort = $$.getConfig(['donut', 'sort'], true);
        $$.__donut_expand = $$.getConfig(['donut', 'expand'], true);
        $$.__donut_title = $$.getConfig(['donut', 'title'], "");

        // region - region to change style
        $$.__regions = $$.getConfig(['regions'], []);

        // tooltip - show when mouseover on each data
        $$.__tooltip_show = $$.getConfig(['tooltip', 'show'], true);
        $$.__tooltip_grouped = $$.getConfig(['tooltip', 'grouped'], true);
        $$.__tooltip_format_title = $$.getConfig(['tooltip', 'format', 'title']);
        $$.__tooltip_format_name = $$.getConfig(['tooltip', 'format', 'name']);
        $$.__tooltip_format_value = $$.getConfig(['tooltip', 'format', 'value']);
        $$.__tooltip_contents = $$.getConfig(['tooltip', 'contents'], function (d, defaultTitleFormat, defaultValueFormat, color) {
            var titleFormat = $$.__tooltip_format_title ? $$.__tooltip_format_title : defaultTitleFormat,
                nameFormat = $$.__tooltip_format_name ? $$.__tooltip_format_name : function (name) { return name; },
                valueFormat = $$.__tooltip_format_value ? $$.__tooltip_format_value : defaultValueFormat,
                text, i, title, value, name, bgcolor;
            for (i = 0; i < d.length; i++) {
                if (! (d[i] && (d[i].value || d[i].value === 0))) { continue; }

                if (! text) {
                    title = titleFormat ? titleFormat(d[i].x) : d[i].x;
                    text = "<table class='" + $$.CLASS.tooltip + "'>" + (title || title === 0 ? "<tr><th colspan='2'>" + title + "</th></tr>" : "");
                }

                name = nameFormat(d[i].name);
                value = valueFormat(d[i].value, d[i].ratio, d[i].id, d[i].index);
                bgcolor = $$.levelColor ? $$.levelColor(d[i].value) : color(d[i].id);

                text += "<tr class='" + $$.CLASS.tooltipName + "-" + d[i].id + "'>";
                text += "<td class='name'><span style='background-color:" + bgcolor + "'></span>" + name + "</td>";
                text += "<td class='value'>" + value + "</td>";
                text += "</tr>";
            }
            return text + "</table>";
        });
        $$.__tooltip_init_show = $$.getConfig(['tooltip', 'init', 'show'], false);
        $$.__tooltip_init_x = $$.getConfig(['tooltip', 'init', 'x'], 0);
        $$.__tooltip_init_position = $$.getConfig(['tooltip', 'init', 'position'], {top: '0px', left: '50px'});

    };

    c3.fn.$$.smoothLines = function (el, type) {
        var $$ = this;
        if (type === 'grid') {
            el.each(function () {
                var g = $$.d3.select(this),
                    x1 = g.attr('x1'),
                    x2 = g.attr('x2'),
                    y1 = g.attr('y1'),
                    y2 = g.attr('y2');
                g.attr({
                    'x1': Math.ceil(x1),
                    'x2': Math.ceil(x2),
                    'y1': Math.ceil(y1),
                    'y2': Math.ceil(y2)
                });
            });
        }
    };


    c3.fn.$$.updateSizes = function () {
        var $$ = this;
        var legendHeight = $$.getLegendHeight(), legendWidth = $$.getLegendWidth(),
            legendHeightForBottom = $$.isLegendRight || $$.isLegendInset ? 0 : legendHeight,
            hasArc = this.hasArcType($$.data.targets),
            xAxisHeight = $$.__axis_rotated || hasArc ? 0 : this.getHorizontalAxisHeight('x'),
            subchartHeight = $$.__subchart_show && !hasArc ? ($$.__subchart_size_height + xAxisHeight) : 0;

        $$.currentWidth = this.getCurrentWidth();
        $$.currentHeight = this.getCurrentHeight();

        // for main, context
        if ($$.__axis_rotated) {
            $$.margin = {
                top: this.getHorizontalAxisHeight('y2') + this.getCurrentPaddingTop(),
                right: hasArc ? 0 : this.getCurrentPaddingRight(),
                bottom: this.getHorizontalAxisHeight('y') + legendHeightForBottom + this.getCurrentPaddingBottom(),
                left: subchartHeight + (hasArc ? 0 : this.getCurrentPaddingLeft())
            };
            $$.margin2 = {
                top: $$.margin.top,
                right: NaN,
                bottom: 20 + legendHeightForBottom,
                left: $$.rotated_padding_left
            };
        } else {
            $$.margin = {
                top: 4 + this.getCurrentPaddingTop(), // for top tick text
                right: hasArc ? 0 : this.getCurrentPaddingRight(),
                bottom: xAxisHeight + subchartHeight + legendHeightForBottom + this.getCurrentPaddingBottom(),
                left: hasArc ? 0 : this.getCurrentPaddingLeft()
            };
            $$.margin2 = {
                top: this.currentHeight - subchartHeight - legendHeightForBottom,
                right: NaN,
                bottom: xAxisHeight + legendHeightForBottom,
                left: $$.margin.left
            };
        }
        // for legend
        var insetLegendPosition = {
            top: $$.isLegendTop ? this.getCurrentPaddingTop() + $$.__legend_inset_y + 5.5 : $$.currentHeight - legendHeight - this.getCurrentPaddingBottom() - $$.__legend_inset_y,
            left: $$.isLegendLeft ? this.getCurrentPaddingLeft() + $$.__legend_inset_x + 0.5 : $$.currentWidth - legendWidth - this.getCurrentPaddingRight() - $$.__legend_inset_x + 0.5
        };
        $$.margin3 = {
            top: $$.isLegendRight ? 0 : $$.isLegendInset ? insetLegendPosition.top : $$.currentHeight - legendHeight,
            right: NaN,
            bottom: 0,
            left: $$.isLegendRight ? $$.currentWidth - legendWidth : $$.isLegendInset ? insetLegendPosition.left : 0
        };

        $$.width = $$.currentWidth - $$.margin.left - $$.margin.right;
        $$.height = $$.currentHeight - $$.margin.top - $$.margin.bottom;
        if ($$.width < 0) { $$.width = 0; }
        if ($$.height < 0) { $$.height = 0; }

        $$.width2 = $$.__axis_rotated ? $$.margin.left - $$.rotated_padding_left - $$.rotated_padding_right : $$.width;
        $$.height2 = $$.__axis_rotated ? $$.height : $$.currentHeight - $$.margin2.top - $$.margin2.bottom;
        if ($$.width2 < 0) { $$.width2 = 0; }
        if ($$.height2 < 0) { $$.height2 = 0; }

        // for arc
        $$.arcWidth = $$.width - ($$.isLegendRight ? legendWidth + 10 : 0);
        $$.arcHeight = $$.height - ($$.isLegendRight ? 0 : 10);
        this.updateRadius();

        if ($$.isLegendRight && hasArc) {
            $$.margin3.left = $$.arcWidth / 2 + $$.radiusExpanded * 1.1;
        }
    };
    c3.fn.$$.updateRadius = function () {
        var $$ = this;
        $$.radiusExpanded = Math.min($$.arcWidth, $$.arcHeight) / 2;
        $$.radius = $$.radiusExpanded * 0.95;
        if (this.hasDonutType($$.data.targets) || this.hasGaugeType($$.data.targets)) {
            $$.innerRadius = $$.radius * ($$.__gauge_width ? ($$.radius - $$.__gauge_width) / $$.radius : 0.6);
        } else {
            $$.innerRadius = 0;
        }
    };



    c3.fn.$$.init = function (data) {
        var $$ = this, d3 = this.d3;
        var arcs, eventRect, grid, i, binding = true;

        $$.selectChart = d3.select($$.__bindto);
        if ($$.selectChart.empty()) {
            $$.selectChart = d3.select(document.createElement('div')).style('opacity', 0);
            this.observeInserted($$.selectChart);
            binding = false;
        }
        $$.selectChart.html("").classed("c3", true);

        // Init data as targets
        $$.data.xs = {};
        $$.data.targets = $$.convertDataToTargets(data);

        if ($$.__data_filter) {
            $$.data.targets = $$.data.targets.filter($$.__data_filter);
        }

        // Set targets to hide if needed
        if ($$.__data_hide) {
            this.addHiddenTargetIds($$.__data_hide === true ? this.mapToIds($$.data.targets) : $$.__data_hide);
        }

        // when gauge, hide legend // TODO: fix
        if (this.hasGaugeType($$.data.targets)) {
            $$.__legend_show = false;
        }

        // Init sizes and scales
        this.updateSizes();
        this.updateScales();

        // Set domains for each scale
        $$.x.domain(d3.extent(this.getXDomain($$.data.targets)));
        $$.y.domain(this.getYDomain($$.data.targets, 'y'));
        $$.y2.domain(this.getYDomain($$.data.targets, 'y2'));
        $$.subX.domain($$.x.domain());
        $$.subY.domain($$.y.domain());
        $$.subY2.domain($$.y2.domain());

        // Save original x domain for zoom update
        $$.orgXDomain = $$.x.domain();

        // Set initialized scales to brush and zoom
        $$.brush.scale($$.subX);
        if ($$.__zoom_enabled) { $$.zoom.scale($$.x); }

        /*-- Basic Elements --*/

        // Define svgs
        $$.svg = $$.selectChart.append("svg")
            .style("overflow", "hidden")
            .on('mouseenter', function () { return $$.__onmouseover.call(c3); })
            .on('mouseleave', function () { return $$.__onmouseout.call(c3); });

        // Define defs
        $$.defs = $$.svg.append("defs");
        $$.defs.append("clipPath").attr("id", $$.clipId).append("rect");
        $$.defs.append("clipPath").attr("id", $$.clipIdForXAxis).append("rect");
        $$.defs.append("clipPath").attr("id", $$.clipIdForYAxis).append("rect");
        $$.updateSvgSize();

        // Define regions
        $$.main = $$.svg.append("g").attr("transform", $$.translate.main);
        $$.context = $$.svg.append("g").attr("transform", $$.translate.context);
        $$.legend = $$.svg.append("g").attr("transform", $$.translate.legend);

        if (!$$.__subchart_show) {
            $$.context.style('visibility', 'hidden');
        }

        if (!$$.__legend_show) {
            $$.legend.style('visibility', 'hidden');
            $$.hiddenLegendIds = $$.mapToIds($$.data.targets);
        }

        // Define tooltip
        $$.tooltip = $$.selectChart
            .style("position", "relative")
          .append("div")
            .style("position", "absolute")
            .style("pointer-events", "none")
            .style("z-index", "10")
            .style("display", "none");

        // MEMO: call here to update legend box and tranlate for all
        // MEMO: translate will be upated by this, so transform not needed in updateLegend()
        $$.updateLegend($$.mapToIds($$.data.targets), {withTransform: false, withTransitionForTransform: false, withTransition: false});

        /*-- Main Region --*/

        // text when empty
        $$.main.append("text")
            .attr("class", this.CLASS.text + ' ' + this.CLASS.empty)
            .attr("text-anchor", "middle") // horizontal centering of text at x position in all browsers.
            .attr("dominant-baseline", "middle"); // vertical centering of text at y position in all browsers, except IE.

        // Regions
        $$.main.append('g')
            .attr("clip-path", $$.clipPath)
            .attr("class", this.CLASS.regions);

        // Grids
        $$.grid = $$.main.append('g')
            .attr("clip-path", $$.clipPath)
            .attr('class', this.CLASS.grid);
        if ($$.__grid_x_show) {
            $$.grid.append("g").attr("class", this.CLASS.xgrids);
        }
        if ($$.__grid_y_show) {
            $$.grid.append('g').attr('class', this.CLASS.ygrids);
        }
        $$.grid.append('g').attr("class", this.CLASS.xgridLines);
        $$.grid.append('g').attr('class', this.CLASS.ygridLines);
        if ($$.__grid_focus_show) {
            $$.grid.append('g')
                .attr("class", this.CLASS.xgridFocus)
              .append('line')
                .attr('class', this.CLASS.xgridFocus);
        }

        // Define g for chart area
        $$.main.append('g')
            .attr("clip-path", $$.clipPath)
            .attr('class', this.CLASS.chart);

        // Cover whole with rects for events
        eventRect = $$.main.select('.' + this.CLASS.chart).append("g")
            .attr("class", this.CLASS.eventRects)
            .style('fill-opacity', 0);

        // Define g for bar chart area
        $$.main.select('.' + this.CLASS.chart).append("g")
            .attr("class", this.CLASS.chartBars);

        // Define g for line chart area
        $$.main.select('.' + this.CLASS.chart).append("g")
            .attr("class", this.CLASS.chartLines);

        // Define g for arc chart area
        arcs = $$.main.select('.' + this.CLASS.chart).append("g")
            .attr("class", this.CLASS.chartArcs)
            .attr("transform", $$.translate.arc);
        arcs.append('text')
            .attr('class', this.CLASS.chartArcsTitle)
            .style("text-anchor", "middle")
            .text(this.getArcTitle());
        if (this.hasGaugeType($$.data.targets)) {
            arcs.append('path')
                .attr("class", this.CLASS.chartArcsBackground)
                .attr("d", function () {
                    var d = {
                        data: [{value: $$.__gauge_max}],
                        startAngle: -1 * (Math.PI / 2),
                        endAngle: Math.PI / 2
                    };
                    return this.getArc(d, true, true);
                });
            arcs.append("text")
                .attr("dy", ".75em")
                .attr("class", this.CLASS.chartArcsGaugeUnit)
                .style("text-anchor", "middle")
                .style("pointer-events", "none")
                .text($$.__gauge_label_show ? $$.__gauge_units : '');
            arcs.append("text")
                .attr("dx", -1 * ($$.innerRadius + (($$.radius - $$.innerRadius) / 2)) + "px")
                .attr("dy", "1.2em")
                .attr("class", this.CLASS.chartArcsGaugeMin)
                .style("text-anchor", "middle")
                .style("pointer-events", "none")
                .text($$.__gauge_label_show ? $$.__gauge_min : '');
            arcs.append("text")
                .attr("dx", $$.innerRadius + (($$.radius - $$.innerRadius) / 2) + "px")
                .attr("dy", "1.2em")
                .attr("class", this.CLASS.chartArcsGaugeMax)
                .style("text-anchor", "middle")
                .style("pointer-events", "none")
                .text($$.__gauge_label_show ? $$.__gauge_max : '');
        }

        $$.main.select('.' + this.CLASS.chart).append("g")
            .attr("class", this.CLASS.chartTexts);

        // if zoom privileged, insert rect to forefront
        $$.main.insert('rect', $$.__zoom_privileged ? null : 'g.' + this.CLASS.regions)
            .attr('class', this.CLASS.zoomRect)
            .attr('width', $$.width)
            .attr('height', $$.height)
            .style('opacity', 0)
            .on("dblclick.zoom", null);

        // Set default extent if defined
        if ($$.__axis_x_default) {
            $$.brush.extent(typeof $$.__axis_x_default !== 'function' ? $$.__axis_x_default : $$.__axis_x_default(this.getXDomain()));
        }

        // Add Axis
        $$.axes.x = $$.main.append("g")
            .attr("class", this.CLASS.axis + ' ' + this.CLASS.axisX)
            .attr("clip-path", $$.clipPathForXAxis)
            .attr("transform", $$.translate.x)
            .style("visibility", $$.__axis_x_show ? 'visible' : 'hidden');
        $$.axes.x.append("text")
            .attr("class", this.CLASS.axisXLabel)
            .attr("transform", $$.__axis_rotated ? "rotate(-90)" : "")
            .style("text-anchor", function () { return $$.textAnchorForXAxisLabel(); });

        $$.axes.y = $$.main.append("g")
            .attr("class", this.CLASS.axis + ' ' + this.CLASS.axisY)
            .attr("clip-path", $$.clipPathForYAxis)
            .attr("transform", $$.translate.y)
            .style("visibility", $$.__axis_y_show ? 'visible' : 'hidden');
        $$.axes.y.append("text")
            .attr("class", this.CLASS.axisYLabel)
            .attr("transform", $$.__axis_rotated ? "" : "rotate(-90)")
            .style("text-anchor", function () { return $$.textAnchorForYAxisLabel(); });

        $$.axes.y2 = $$.main.append("g")
            .attr("class", this.CLASS.axis + ' ' + this.CLASS.axisY2)
            // clip-path?
            .attr("transform", $$.translate.y2)
            .style("visibility", $$.__axis_y2_show ? 'visible' : 'hidden');
        $$.axes.y2.append("text")
            .attr("class", this.CLASS.axisY2Label)
            .attr("transform", $$.__axis_rotated ? "" : "rotate(-90)")
            .style("text-anchor", function () { return $$.textAnchorForY2AxisLabel(); });

        /*-- Context Region --*/

        // Define g for chart area
        $$.context.append('g')
            .attr("clip-path", $$.clipPath)
            .attr('class', this.CLASS.chart);

        // Define g for bar chart area
        $$.context.select('.' + this.CLASS.chart).append("g")
            .attr("class", this.CLASS.chartBars);

        // Define g for line chart area
        $$.context.select('.' + this.CLASS.chart).append("g")
            .attr("class", this.CLASS.chartLines);

        // Add extent rect for Brush
        $$.context.append("g")
            .attr("clip-path", $$.clipPath)
            .attr("class", this.CLASS.brush)
            .call($$.brush)
          .selectAll("rect")
            .attr($$.__axis_rotated ? "width" : "height", $$.__axis_rotated ? $$.width2 : $$.height2);

        // ATTENTION: This must be called AFTER chart added
        // Add Axis
        $$.axes.subx = $$.context.append("g")
            .attr("class", this.CLASS.axisX)
            .attr("transform", $$.translate.subx)
            .attr("clip-path", $$.__axis_rotated ? "" : $$.clipPathForXAxis);

        // Set targets
        this.updateTargets($$.data.targets);

        // Draw with targets
        if (binding) {
            this.updateDimension();
            this.redraw({
                withTransform: true,
                withUpdateXDomain: true,
                withUpdateOrgXDomain: true,
                withTransitionForAxis: false
            });
        }

        // Show tooltip if needed
        if ($$.__tooltip_init_show) {
            if ($$.isTimeSeries && typeof $$.__tooltip_init_x === 'string') {
                $$.__tooltip_init_x = this.parseDate($$.__tooltip_init_x);
                for (i = 0; i < $$.data.targets[0].values.length; i++) {
                    if (($$.data.targets[0].values[i].x - $$.__tooltip_init_x) === 0) { break; }
                }
                $$.__tooltip_init_x = i;
            }
            $$.tooltip.html($$.__tooltip_contents($$.data.targets.map(function (d) {
                return this.addName(d.values[$$.__tooltip_init_x]);
            }), this.getXAxisTickFormat(), this.getYFormat(this.hasArcType($$.data.targets)), $$.color));
            $$.tooltip.style("top", $$.__tooltip_init_position.top)
                .style("left", $$.__tooltip_init_position.left)
                .style("display", "block");
        }

        // Bind resize event
        if (window.onresize == null) {
            window.onresize = this.generateResize();
        }
        if (window.onresize.add) {
            window.onresize.add(function () {
                $$.__onresize.call(c3);
            });
            window.onresize.add(function () {
                $$.this.flush();
            });
            window.onresize.add(function () {
                $$.__onresized.call(c3);
            });
        }

        // export element of the chart
        $$.this.element = $$.selectChart.node();
    };


    c3.fn.$$.updateTargets = function (targets) {
        var mainLineEnter, mainLineUpdate, mainBarEnter, mainBarUpdate, mainPieEnter, mainPieUpdate, mainTextUpdate, mainTextEnter;
        var contextLineEnter, contextLineUpdate, contextBarEnter, contextBarUpdate;
        var $$ = this, main = $$.main, context = $$.context, CLASS = $$.CLASS;

        /*-- Main --*/

        //-- Text --//
        mainTextUpdate = main.select('.' + CLASS.chartTexts).selectAll('.' + CLASS.chartText)
            .data(targets)
            .attr('class', function (d) { return $$.classChartText(d); });
        mainTextEnter = mainTextUpdate.enter().append('g')
            .attr('class', function (d) { return $$.classChartText(d); })
            .style('opacity', 0)
            .style("pointer-events", "none");
        mainTextEnter.append('g')
            .attr('class', function (d) { return $$.classTexts(d); });

        //-- Bar --//
        mainBarUpdate = main.select('.' + CLASS.chartBars).selectAll('.' + CLASS.chartBar)
            .data(targets)
            .attr('class', function (d) { return $$.classChartBar(d); });
        mainBarEnter = mainBarUpdate.enter().append('g')
            .attr('class', function (d) { return $$.classChartBar(d); })
            .style('opacity', 0)
            .style("pointer-events", "none");
        // Bars for each data
        mainBarEnter.append('g')
            .attr("class", function (d) { return $$.classBars(d); })
            .style("cursor", function (d) { return $$.__data_selection_isselectable(d) ? "pointer" : null; });

        //-- Line --//
        mainLineUpdate = main.select('.' + CLASS.chartLines).selectAll('.' + CLASS.chartLine)
            .data(targets)
            .attr('class', function (d) { return $$.classChartLine(d); });
        mainLineEnter = mainLineUpdate.enter().append('g')
            .attr('class', function (d) { return $$.classChartLine(d); })
            .style('opacity', 0)
            .style("pointer-events", "none");
        // Lines for each data
        mainLineEnter.append('g')
            .attr("class", function (d) { return $$.classLines(d); });
        // Areas
        mainLineEnter.append('g')
            .attr('class', function (d) { return $$.classAreas(d); });
        // Circles for each data point on lines
        mainLineEnter.append('g')
            .attr("class", function (d) { return $$.generateClass(CLASS.selectedCircles, d.id); });
        mainLineEnter.append('g')
            .attr("class", function (d) { return $$.classCircles(d); })
            .style("cursor", function (d) { return $$.__data_selection_isselectable(d) ? "pointer" : null; });
        // Update date for selected circles
        targets.forEach(function (t) {
            main.selectAll('.' + CLASS.selectedCircles + $$.getTargetSelectorSuffix(t.id)).selectAll('.' + CLASS.selectedCircle).each(function (d) {
                d.value = t.values[d.index].value;
            });
        });
        // MEMO: can not keep same color...
        //mainLineUpdate.exit().remove();

        //-- Pie --//
        mainPieUpdate = main.select('.' + CLASS.chartArcs).selectAll('.' + CLASS.chartArc)
            .data($$.pie(targets))
            .attr("class", function (d) { return $$.classChartArc(d); });
        mainPieEnter = mainPieUpdate.enter().append("g")
            .attr("class", function (d) { return $$.classChartArc(d); });
        mainPieEnter.append('g')
            .attr('class', function (d) { return $$.classArcs(d); });
        mainPieEnter.append("text")
            .attr("dy", $$.hasGaugeType($$.data.targets) ? "-0.35em" : ".35em")
            .style("opacity", 0)
            .style("text-anchor", "middle")
            .style("pointer-events", "none");
        // MEMO: can not keep same color..., but not bad to update color in redraw
        //mainPieUpdate.exit().remove();

        /*-- Context --*/

        if ($$.__subchart_show) {

            contextBarUpdate = context.select('.' + CLASS.chartBars).selectAll('.' + CLASS.chartBar)
                .data(targets)
                .attr('class', $$.classChartBar);
            contextBarEnter = contextBarUpdate.enter().append('g')
                .style('opacity', 0)
                .attr('class', $$.classChartBar);
            // Bars for each data
            contextBarEnter.append('g')
                .attr("class", $$.classBars);

            //-- Line --//
            contextLineUpdate = context.select('.' + CLASS.chartLines).selectAll('.' + CLASS.chartLine)
                .data(targets)
                .attr('class', $$.classChartLine);
            contextLineEnter = contextLineUpdate.enter().append('g')
                .style('opacity', 0)
                .attr('class', $$.classChartLine);
            // Lines for each data
            contextLineEnter.append("g")
                .attr("class", $$.classLines);
            // Area
            contextLineEnter.append("g")
                .attr("class", $$.classAreas);
        }

        /*-- Show --*/

        // Fade-in each chart
        $$.svg.selectAll('.' + CLASS.target).filter(function (d) { return $$.isTargetToShow(d.id); })
          .transition().duration($$.__transition_duration)
            .style("opacity", 1);
    };

    c3.fn.$$.redraw = function (options, transitions) {
        var $$ = this, main = $$.main, context = $$.context, CLASS = $$.CLASS, d3 = $$.d3;
        var xgrid, xgridAttr, xgridData, xgridLines, xgridLine, ygrid, ygridLines, ygridLine, flushXGrid;
        var mainLine, mainArea, mainCircle, mainBar, mainArc, mainRegion, mainText, contextLine,  contextArea, contextBar, eventRect, eventRectUpdate;
        var areaIndices = $$.getShapeIndices($$.isAreaType), barIndices = $$.getShapeIndices($$.isBarType), lineIndices = $$.getShapeIndices($$.isLineType), maxDataCountTarget, tickOffset;
        var rectX, rectW;
        var withY, withSubchart, withTransition, withTransitionForExit, withTransitionForAxis, withTransform, withUpdateXDomain, withUpdateOrgXDomain, withLegend;
        var hideAxis = $$.hasArcType($$.data.targets);
        var drawArea, drawAreaOnSub, drawBar, drawBarOnSub, drawLine, drawLineOnSub, xForText, yForText;
        var duration, durationForExit, durationForAxis, waitForDraw;
        var targetsToShow = $$.filterTargetsToShow($$.data.targets), tickValues, i, intervalForCulling;

        xgrid = xgridLines = mainCircle = mainText = $$.getEmptySelection();

        options = options || {};
        withY = $$.getOption(options, "withY", true);
        withSubchart = $$.getOption(options, "withSubchart", true);
        withTransition = $$.getOption(options, "withTransition", true);
        withTransform = $$.getOption(options, "withTransform", false);
        withUpdateXDomain = $$.getOption(options, "withUpdateXDomain", false);
        withUpdateOrgXDomain = $$.getOption(options, "withUpdateOrgXDomain", false);
        withLegend = $$.getOption(options, "withLegend", false);
        withTransitionForExit = $$.getOption(options, "withTransitionForExit", withTransition);
        withTransitionForAxis = $$.getOption(options, "withTransitionForAxis", withTransition);

        duration = withTransition ? $$.__transition_duration : 0;
        durationForExit = withTransitionForExit ? duration : 0;
        durationForAxis = withTransitionForAxis ? duration : 0;

        transitions = transitions || $$.generateAxisTransitions(durationForAxis);

        // update legend and transform each g
        if (withLegend && $$.__legend_show) {
            $$.updateLegend($$.mapToIds($$.data.targets), options, transitions);
        }

        // MEMO: needed for grids calculation
        if ($$.isCategorized && targetsToShow.length === 0) {
            $$.x.domain([0, $$.axes.x.selectAll('.tick').size()]);
        }

        if (targetsToShow.length) {
            $$.updateXDomain(targetsToShow, withUpdateXDomain, withUpdateOrgXDomain);
            // update axis tick values according to options
            if (!$$.__axis_x_tick_values && ($$.__axis_x_tick_fit || $$.__axis_x_tick_count)) {
                tickValues = $$.generateTickValues($$.mapTargetsToUniqueXs(targetsToShow), $$.__axis_x_tick_count);
                $$.xAxis.tickValues(tickValues);
                $$.subXAxis.tickValues(tickValues);
            }
        } else {
            $$.xAxis.tickValues([]);
            $$.subXAxis.tickValues([]);
        }

        $$.y.domain($$.getYDomain(targetsToShow, 'y'));
        $$.y2.domain($$.getYDomain(targetsToShow, 'y2'));

        // axes
        $$.axes.x.style("opacity", hideAxis ? 0 : 1);
        $$.axes.y.style("opacity", hideAxis ? 0 : 1);
        $$.axes.y2.style("opacity", hideAxis ? 0 : 1);
        $$.axes.subx.style("opacity", hideAxis ? 0 : 1);
        transitions.axisX.call($$.xAxis);
        transitions.axisY.call($$.yAxis);
        transitions.axisY2.call($$.y2Axis);
        transitions.axisSubX.call($$.subXAxis);

        // Update axis label
        $$.updateAxisLabels(withTransition);

        // show/hide if manual culling needed
        if (withUpdateXDomain && targetsToShow.length) {
            if ($$.__axis_x_tick_culling && tickValues) {
                for (i = 1; i < tickValues.length; i++) {
                    if (tickValues.length / i < $$.__axis_x_tick_culling_max) {
                        intervalForCulling = i;
                        break;
                    }
                }
                $$.svg.selectAll('.' + CLASS.axisX + ' .tick text').each(function (e) {
                    var index = tickValues.indexOf(e);
                    if (index >= 0) {
                        d3.select(this).style('display', index % intervalForCulling ? 'none' : 'block');
                    }
                });
            } else {
                $$.svg.selectAll('.' + CLASS.axisX + ' .tick text').style('display', 'block');
            }
        }

        // rotate tick text if needed
        if (!$$.__axis_rotated && $$.__axis_x_tick_rotate) {
            $$.rotateTickText($$.axes.x, transitions.axisX, $$.__axis_x_tick_rotate);
        }

        // setup drawer - MEMO: these must be called after axis updated
        drawArea = $$.generateDrawArea(areaIndices, false);
        drawBar = $$.generateDrawBar(barIndices);
        drawLine = $$.generateDrawLine(lineIndices, false);
        xForText = $$.generateXYForText(barIndices, true);
        yForText = $$.generateXYForText(barIndices, false);

        // Update sub domain
        $$.subY.domain($$.y.domain());
        $$.subY2.domain($$.y2.domain());

        // tooltip
        $$.tooltip.style("display", "none");

        // xgrid focus
        $$.updateXgridFocus();

        // Data empty label positioning and text.
        main.select("text." + CLASS.text + '.' + CLASS.empty)
            .attr("x", $$.width / 2)
            .attr("y", $$.height / 2)
            .text($$.__data_empty_label_text)
          .transition()
            .style('opacity', targetsToShow.length ? 0 : 1);

        // grid
        main.select('line.' + CLASS.xgridFocus).style("visibility", "hidden");
        if ($$.__grid_x_show) {
            xgridAttr = $$.__axis_rotated ? {
                'x1': 0,
                'x2': $$.width,
                'y1': function (d) { return $$.x(d) - tickOffset; },
                'y2': function (d) { return $$.x(d) - tickOffset; }
            } : {
                'x1': function (d) { return $$.x(d) + tickOffset; },
                'x2': function (d) { return $$.x(d) + tickOffset; },
                'y1': 0,
                'y2': $$.height
            };
            // this is used to flow
            flushXGrid = function (withoutUpdate) {
                xgridData = $$.generateGridData($$.__grid_x_type, $$.x);
                tickOffset = $$.isCategorized ? $$.xAxis.tickOffset() : 0;
                xgrid = main.select('.' + CLASS.xgrids).selectAll('.' + CLASS.xgrid)
                    .data(xgridData);
                xgrid.enter().append('line').attr("class", CLASS.xgrid);
                if (!withoutUpdate) {
                    xgrid.attr(xgridAttr)
                        .style("opacity", function () { return +d3.select(this).attr($$.__axis_rotated ? 'y1' : 'x1') === ($$.__axis_rotated ? $$.height : 0) ? 0 : 1; });
                }
                xgrid.exit().remove();
            };
            flushXGrid();
        }
        xgridLines = main.select('.' + CLASS.xgridLines).selectAll('.' + CLASS.xgridLine)
            .data($$.__grid_x_lines);
        // enter
        xgridLine = xgridLines.enter().append('g')
            .attr("class", function (d) { return CLASS.xgridLine + (d.class ? ' ' + d.class : ''); });
        xgridLine.append('line')
            .style("opacity", 0);
        xgridLine.append('text')
            .attr("text-anchor", "end")
            .attr("transform", $$.__axis_rotated ? "" : "rotate(-90)")
            .attr('dx', $$.__axis_rotated ? 0 : -$$.margin.top)
            .attr('dy', -5)
            .style("opacity", 0);
        // udpate
        // done in d3.transition() of the end of this function
        // exit
        xgridLines.exit().transition().duration(duration)
            .style("opacity", 0)
            .remove();
        // Y-Grid
        if (withY && $$.__grid_y_show) {
            ygrid = main.select('.' + CLASS.ygrids).selectAll('.' + CLASS.ygrid)
                .data($$.y.ticks($$.__grid_y_ticks));
            ygrid.enter().append('line')
                .attr('class', CLASS.ygrid);
            ygrid.attr("x1", $$.__axis_rotated ? $$.y : 0)
                .attr("x2", $$.__axis_rotated ? $$.y : $$.width)
                .attr("y1", $$.__axis_rotated ? 0 : $$.y)
                .attr("y2", $$.__axis_rotated ? $$.height : $$.y);
            ygrid.exit().remove();
            $$.smoothLines(ygrid, 'grid');
        }
        if (withY) {
            ygridLines = main.select('.' + CLASS.ygridLines).selectAll('.' + CLASS.ygridLine)
                .data($$.__grid_y_lines);
            // enter
            ygridLine = ygridLines.enter().append('g')
                .attr("class", function (d) { return CLASS.ygridLine + (d.class ? ' ' + d.class : ''); });
            ygridLine.append('line')
                .style("opacity", 0);
            ygridLine.append('text')
                .attr("text-anchor", "end")
                .attr("transform", $$.__axis_rotated ? "rotate(-90)" : "")
                .attr('dx', $$.__axis_rotated ? 0 : -$$.margin.top)
                .attr('dy', -5)
                .style("opacity", 0);
            // update
            var yv = function (d) { return $$.yv.call($$, d); };
            ygridLines.select('line')
              .transition().duration(duration)
                .attr("x1", $$.__axis_rotated ? yv : 0)
                .attr("x2", $$.__axis_rotated ? yv : $$.width)
                .attr("y1", $$.__axis_rotated ? 0 : yv)
                .attr("y2", $$.__axis_rotated ? $$.height : yv)
                .style("opacity", 1);
            ygridLines.select('text')
              .transition().duration(duration)
                .attr("x", $$.__axis_rotated ? 0 : $$.width)
                .attr("y", yv)
                .text(function (d) { return d.text; })
                .style("opacity", 1);
            // exit
            ygridLines.exit().transition().duration(duration)
                .style("opacity", 0)
                .remove();
        }

        // rect for regions
        mainRegion = main.select('.' + CLASS.regions).selectAll('.' + CLASS.region)
            .data($$.__regions);
        mainRegion.enter().append('g')
            .attr('class', function (d) { return $$.classRegion(d); })
          .append('rect')
            .style("fill-opacity", 0);
        mainRegion.exit().transition().duration(duration)
            .style("opacity", 0)
            .remove();

        // bars
        mainBar = main.selectAll('.' + CLASS.bars).selectAll('.' + CLASS.bar)
            .data(function (d) { return $$.barData(d); });
        mainBar.enter().append('path')
            .attr("class", function (d) { return $$.classBar(d); })
            .style("stroke", function (d) { return $$.color(d.id); })
            .style("fill", function (d) { return $$.color(d.id); });
        mainBar
            .style("opacity", function (d) { return $$.initialOpacity(d); });
        mainBar.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();

        // lines, areas and cricles
        mainLine = main.selectAll('.' + CLASS.lines).selectAll('.' + CLASS.line)
            .data(function (d) { return $$.lineData(d); });
        mainLine.enter().append('path')
            .attr('class', function (d) { return $$.classLine(d); })
            .style("stroke", $$.color);
        mainLine
            .style("opacity", function (d) { return $$.initialOpacity(d); })
            .attr('transform', null);
        mainLine.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();

        mainArea = main.selectAll('.' + CLASS.areas).selectAll('.' + CLASS.area)
            .data(function (d) { return $$.lineData(d); });
        mainArea.enter().append('path')
            .attr("class", function (d) { return $$.classArea(d); })
            .style("fill", $$.color)
            .style("opacity", function () { $$.orgAreaOpacity = +d3.select(this).style('opacity'); return 0; });
        mainArea
            .style("opacity", $$.orgAreaOpacity);
        mainArea.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();

        if ($$.__point_show) {
            mainCircle = main.selectAll('.' + CLASS.circles).selectAll('.' + CLASS.circle)
                .data(function (d) { return $$.lineOrScatterData(d); });
            mainCircle.enter().append("circle")
                .attr("class", function (d) { return $$.classCircle(d); })
                .attr("r", function (d) { return $$.pointR(d); })
                .style("fill", $$.color);
            mainCircle
                .style("opacity", function (d) { return $$.initialOpacity(d); });
            mainCircle.exit().remove();
        }

        if ($$.hasDataLabel()) {
            mainText = main.selectAll('.' + CLASS.texts).selectAll('.' + CLASS.text)
                .data($$.barOrLineData);
            mainText.enter().append('text')
                .attr("class", function (d) { return $$.classText(d); })
                .attr('text-anchor', function (d) { return $$.__axis_rotated ? (d.value < 0 ? 'end' : 'start') : 'middle'; })
                .style("stroke", 'none')
                .style("fill", function (d) { return $$.color(d); })
                .style("fill-opacity", 0);
            mainText
                .text(function (d) { return $$.formatByAxisId($$.getAxisId(d.id))(d.value, d.id); });
            mainText.exit()
                .transition().duration(durationForExit)
                .style('fill-opacity', 0)
                .remove();
        }

        // arc
        mainArc = main.selectAll('.' + CLASS.arcs).selectAll('.' + CLASS.arc)
            .data(function (d) { return $$.arcData(d); });
        mainArc.enter().append('path')
            .attr("class", function (d) { return $$.classArc(d); })
            .style("fill", function (d) { return $$.color(d.data); })
            .style("cursor", function (d) { return $$.__data_selection_isselectable(d) ? "pointer" : null; })
            .style("opacity", 0)
            .each(function (d) {
                if ($$.isGaugeType(d.data)) {
                    d.startAngle = d.endAngle = -1 * (Math.PI / 2);
                }
                this._current = d;
            })
            .on('mouseover', function (d) {
                var updated, arcData;
                if ($$.transiting) { // skip while transiting
                    return;
                }
                updated = $$.updateAngle(d);
                arcData = $$.convertToArcData(updated);
                // transitions
                $$.expandArc(updated.data.id);
                $$.toggleFocusLegend(updated.data.id, true);
                $$.__data_onmouseover.call(c3, arcData, this);
            })
            .on('mousemove', function (d) {
                var updated = $$.updateAngle(d),
                    arcData = $$.convertToArcData(updated),
                    selectedData = [arcData];
                $$.showTooltip(selectedData, d3.mouse(this));
            })
            .on('mouseout', function (d) {
                var updated, arcData;
                if ($$.transiting) { // skip while transiting
                    return;
                }
                updated = $$.updateAngle(d);
                arcData = $$.convertToArcData(updated);
                // transitions
                $$.unexpandArc(updated.data.id);
                $$.revertLegend();
                $$.hideTooltip();
                $$.__data_onmouseout.call(c3, arcData, this);
            })
            .on('click', function (d, i) {
                var updated = $$.updateAngle(d),
                    arcData = $$.convertToArcData(updated);
                $$.toggleShape(this, arcData, i); // onclick called in toogleShape()
            });
        mainArc
            .attr("transform", function (d) { return !$$.isGaugeType(d.data) && withTransform ? "scale(0)" : ""; })
            .style("opacity", function (d) { return d === this._current ? 0 : 1; })
            .each(function () { $$.transiting = true; })
          .transition().duration(duration)
            .attrTween("d", function (d) {
                var updated = $$.updateAngle(d), interpolate;
                if (! updated) {
                    return function () { return "M 0 0"; };
                }
/*
                if (this._current === d) {
                    this._current = {
                        startAngle: Math.PI*2,
                        endAngle: Math.PI*2,
                    };
                }
*/
                if (isNaN(this._current.endAngle)) {
                    this._current.endAngle = this._current.startAngle;
                }
                interpolate = d3.interpolate(this._current, updated);
                this._current = interpolate(0);
                return function (t) { return $$.getArc(interpolate(t), true); };
            })
            .attr("transform", withTransform ? "scale(1)" : "")
            .style("fill", function (d) {
                return $$.levelColor ? $$.levelColor(d.data.values[0].value) : $$.color(d.data.id);
            }) // Where gauge reading color would receive customization.
            .style("opacity", 1)
            .call($$.endall, function () {
                $$.transiting = false;
            });
        mainArc.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();
        main.selectAll('.' + CLASS.chartArc).select('text')
            .style("opacity", 0)
            .attr('class', function (d) { return $$.isGaugeType(d.data) ? CLASS.gaugeValue : ''; })
            .text(function (d) { return $$.textForArcLabel(d); })
            .attr("transform", function (d) { return $$.transformForArcLabel(d); })
          .transition().duration(duration)
            .style("opacity", function (d) { return $$.isTargetToShow(d.data.id) && $$.isArcType(d.data) ? 1 : 0; });
        main.select('.' + CLASS.chartArcsTitle)
            .style("opacity", $$.hasDonutType($$.data.targets) || $$.hasGaugeType($$.data.targets) ? 1 : 0);

        // subchart
        if ($$.__subchart_show) {
            // reflect main chart to extent on subchart if zoomed
            if (d3.event && d3.event.type === 'zoom') {
                $$.brush.extent($$.x.orgDomain()).update();
            }
            // update subchart elements if needed
            if (withSubchart) {

                // rotate tick text if needed
                if (!$$.__axis_rotated && $$.__axis_x_tick_rotate) {
                    $$.rotateTickText($$.axes.subx, transitions.axisSubX, $$.__axis_x_tick_rotate);
                }

                // extent rect
                if (!$$.brush.empty()) {
                    $$.brush.extent($$.x.orgDomain()).update();
                }
                // setup drawer - MEMO: this must be called after axis updated
                drawAreaOnSub = $$.generateDrawArea(areaIndices, true);
                drawBarOnSub = $$.generateDrawBar(barIndices, true);
                drawLineOnSub = $$.generateDrawLine(lineIndices, true);
                // bars
                contextBar = context.selectAll('.' + CLASS.bars).selectAll('.' + CLASS.bar)
                    .data($$.barData);
                contextBar.enter().append('path')
                    .attr("class", $$.classBar)
                    .style("stroke", 'none')
                    .style("fill", $$.color);
                contextBar
                    .style("opacity", $$.initialOpacity)
                  .transition().duration(duration)
                    .attr('d', drawBarOnSub)
                    .style('opacity', 1);
                contextBar.exit().transition().duration(duration)
                    .style('opacity', 0)
                    .remove();
                // lines
                contextLine = context.selectAll('.' + CLASS.lines).selectAll('.' + CLASS.line)
                    .data($$.lineData);
                contextLine.enter().append('path')
                    .attr('class', function (d) { return $$.classLine(d); })
                    .style('stroke', $$.color);
                contextLine
                    .style("opacity", $$.initialOpacity)
                  .transition().duration(duration)
                    .attr("d", drawLineOnSub)
                    .style('opacity', 1);
                contextLine.exit().transition().duration(duration)
                    .style('opacity', 0)
                    .remove();
                // area
                contextArea = context.selectAll('.' + CLASS.areas).selectAll('.' + CLASS.area)
                    .data($$.lineData);
                contextArea.enter().append('path')
                    .attr("class", function (d) { return $$.classArea(d); })
                    .style("fill", $$.color)
                    .style("opacity", function () { $$.orgAreaOpacity = +d3.select(this).style('opacity'); return 0; });
                contextArea
                    .style("opacity", 0)
                  .transition().duration(duration)
                    .attr("d", drawAreaOnSub)
                    .style("fill", $$.color)
                    .style("opacity", $$.orgAreaOpacity);
                contextArea.exit().transition().duration(durationForExit)
                    .style('opacity', 0)
                    .remove();
            }
        }

        // circles for select
        main.selectAll('.' + CLASS.selectedCircles)
            .filter(function (d) { return $$.isBarType(d); })
            .selectAll('circle')
            .remove();

        if ($$.__interaction_enabled) {
            // rect for mouseover
            eventRect = main.select('.' + CLASS.eventRects)
                .style('cursor', $$.__zoom_enabled ? $$.__axis_rotated ? 'ns-resize' : 'ew-resize' : null);
            if ($$.notEmpty($$.__data_xs) && !$$.isSingleX($$.__data_xs)) {

                if (!eventRect.classed(CLASS.eventRectsMultiple)) {
                    eventRect.classed(CLASS.eventRectsMultiple, true).classed(CLASS.eventRectsSingle, false)
                        .selectAll('.' + CLASS.eventRect).remove();
                }

                eventRectUpdate = main.select('.' + CLASS.eventRects).selectAll('.' + CLASS.eventRect)
                    .data([0]);
                // enter : only one rect will be added
                $$.generateEventRectsForMultipleXs(eventRectUpdate.enter());
                // update
                eventRectUpdate
                    .attr('x', 0)
                    .attr('y', 0)
                    .attr('width', $$.width)
                    .attr('height', $$.height);
                // exit : not needed because always only one rect exists
            } else {

                if (!eventRect.classed(CLASS.eventRectsSingle)) {
                    eventRect.classed(CLASS.eventRectsMultiple, false).classed(CLASS.eventRectsSingle, true)
                        .selectAll('.' + CLASS.eventRect).remove();
                }

                if (($$.isCustomX() || $$.isTimeSeries) && !$$.isCategorized) {
                    rectW = function (d) {
                        var prevX = $$.getPrevX(d.index), nextX = $$.getNextX(d.index), dx = $$.data.xs[d.id][d.index],
                            w = ($$.x(nextX ? nextX : dx) - $$.x(prevX ? prevX : dx)) / 2;
                        return w < 0 ? 0 : w;
                    };
                    rectX = function (d) {
                        var prevX = $$.getPrevX(d.index), dx = $$.data.xs[d.id][d.index];
                        return ($$.x(dx) + $$.x(prevX ? prevX : dx)) / 2;
                    };
                } else {
                    rectW = $$.getEventRectWidth();
                    rectX = function (d) {
                        return $$.x(d.x) - (rectW / 2);
                    };
                }
                // Set data
                maxDataCountTarget = $$.getMaxDataCountTarget($$.data.targets);
                main.select('.' + CLASS.eventRects)
                    .datum(maxDataCountTarget ? maxDataCountTarget.values : []);
                // Update rects
                eventRectUpdate = main.select('.' + CLASS.eventRects).selectAll('.' + CLASS.eventRect)
                    .data(function (d) { return d; });
                // enter
                $$.generateEventRectsForSingleX(eventRectUpdate.enter());
                // update
                eventRectUpdate
                    .attr('class', function (d) { return $$.classEvent(d); })
                    .attr("x", $$.__axis_rotated ? 0 : rectX)
                    .attr("y", $$.__axis_rotated ? rectX : 0)
                    .attr("width", $$.__axis_rotated ? $$.width : rectW)
                    .attr("height", $$.__axis_rotated ? rectW : $$.height);
                // exit
                eventRectUpdate.exit().remove();
            }
        }

        // transition should be derived from one transition
        d3.transition().duration(duration).each(function () {
            var transitions = [],
                cx = $$.__axis_rotated ? $$.circleY : $$.circleX,
                cy = $$.__axis_rotated ? $$.circleX : $$.circleY;

            transitions.push(mainBar.transition()
                .attr('d', drawBar)
                .style("fill", $$.color)
                .style("opacity", 1));
            transitions.push(mainLine.transition()
                .attr("d", drawLine)
                .style("stroke", $$.color)
                .style("opacity", 1));
            transitions.push(mainArea.transition()
                .attr("d", drawArea)
                .style("fill", $$.color)
                .style("opacity", $$.orgAreaOpacity));
            transitions.push(mainCircle.transition()
                .style('opacity', function (d) { return $$.opacityForCircle(d); })
                .style("fill", $$.color)
                .attr("cx", function (d, i) { return cx.call($$, d, i); })
                .attr("cy", function (d, i) { return cy.call($$, d, i); }));
            transitions.push(main.selectAll('.' + CLASS.selectedCircle).transition()
                .attr("cx", function (d, i) { return cx.call($$, d, i); })
                .attr("cy", function (d, i) { return cy.call($$, d, i); }));
            transitions.push(mainText.transition()
                .attr('x', xForText)
                .attr('y', yForText)
                .style("fill", $$.color)
                .style("fill-opacity", options.flow ? 0 : $$.opacityForText));
            transitions.push(mainRegion.selectAll('rect').transition()
                .attr("x", $$.regionX)
                .attr("y", $$.regionY)
                .attr("width", $$.regionWidth)
                .attr("height", $$.regionHeight)
                .style("fill-opacity", function (d) { return $$.isValue(d.opacity) ? d.opacity : 0.1; }));
            transitions.push(xgridLines.select('line').transition()
                .attr("x1", $$.__axis_rotated ? 0 : $$.xv)
                .attr("x2", $$.__axis_rotated ? $$.width : $$.xv)
                .attr("y1", $$.__axis_rotated ? $$.xv : $$.margin.top)
                .attr("y2", $$.__axis_rotated ? $$.xv : $$.height)
                .style("opacity", 1));
            transitions.push(xgridLines.select('text').transition()
                .attr("x", $$.__axis_rotated ? $$.width : 0)
                .attr("y", $$.xv)
                .text(function (d) { return d.text; })
                .style("opacity", 1));
            // Wait for end of transitions if called from flow API
            if (options.flow) {
                waitForDraw = $$.generateWait();
                transitions.forEach(function (t) {
                    waitForDraw.add(t);
                });
            }
        })
        .call(waitForDraw ? waitForDraw : function () {}, function () { // only for flow
            var translateX, scaleX = 1, transform,
                flowIndex = options.flow.index,
                flowLength = options.flow.length,
                flowStart = $$.getValueOnIndex($$.data.targets[0].values, flowIndex),
                flowEnd = $$.getValueOnIndex($$.data.targets[0].values, flowIndex + flowLength),
                orgDomain = $$.x.domain(), domain,
                durationForFlow = options.flow.duration || duration,
                done = options.flow.done || function () {},
                wait = $$.generateWait();

            // remove head data after rendered
            $$.data.targets.forEach(function (d) {
                d.values.splice(0, flowLength);
            });

            // update x domain to generate axis elements for flow
            domain = $$.updateXDomain(targetsToShow, true, true);
            // update elements related to x scale
            if (flushXGrid) { flushXGrid(true); }

            // generate transform to flow
            if (!options.flow.orgDataCount) { // if empty
                if ($$.data.targets[0].values.length !== 1) {
                    translateX = $$.x(orgDomain[0]) - $$.x(domain[0]);
                } else {
                    if ($$.isTimeSeries) {
                        flowStart = $$.getValueOnIndex($$.data.targets[0].values, 0);
                        flowEnd = $$.getValueOnIndex($$.data.targets[0].values, $$.data.targets[0].values.length - 1);
                        translateX = $$.x(flowStart.x) - $$.x(flowEnd.x);
                    } else {
                        translateX = $$.diffDomain(domain) / 2;
                    }
                }
            } else if (options.flow.orgDataCount === 1 || flowStart.x === flowEnd.x) {
                translateX = $$.x(orgDomain[0]) - $$.x(domain[0]);
            } else {
                if ($$.isTimeSeries) {
                    translateX = ($$.x(orgDomain[0]) - $$.x(domain[0]));
                } else {
                    translateX = ($$.x(flowStart.x) - $$.x(flowEnd.x));
                }
            }
            scaleX = ($$.diffDomain(orgDomain) / $$.diffDomain(domain));
            transform = 'translate(' + translateX + ',0) scale(' + scaleX + ',1)';

            d3.transition().ease('linear').duration(durationForFlow).each(function () {
                wait.add($$.axes.x.transition().call($$.xAxis));
                wait.add(mainBar.transition().attr('transform', transform));
                wait.add(mainLine.transition().attr('transform', transform));
                wait.add(mainArea.transition().attr('transform', transform));
                wait.add(mainCircle.transition().attr('transform', transform));
                wait.add(mainText.transition().attr('transform', transform));
                wait.add(mainRegion.filter($$.isRegionOnX).transition().attr('transform', transform));
                wait.add(xgrid.transition().attr('transform', transform));
                wait.add(xgridLines.transition().attr('transform', transform));
            })
            .call(wait, function () {
                var i, shapes = [], texts = [], eventRects = [];

                // remove flowed elements
                if (flowLength) {
                    for (i = 0; i < flowLength; i++) {
                        shapes.push('.' + CLASS.shape + '-' + (flowIndex + i));
                        texts.push('.' + CLASS.text + '-' + (flowIndex + i));
                        eventRects.push('.' + CLASS.eventRect + '-' + (flowIndex + i));
                    }
                    $$.svg.selectAll('.' + CLASS.shapes).selectAll(shapes).remove();
                    $$.svg.selectAll('.' + CLASS.texts).selectAll(texts).remove();
                    $$.svg.selectAll('.' + CLASS.eventRects).selectAll(eventRects).remove();
                    $$.svg.select('.' + CLASS.xgrid).remove();
                }

                // draw again for removing flowed elements and reverting attr
                xgrid
                    .attr('transform', null)
                    .attr(xgridAttr);
                xgridLines
                    .attr('transform', null);
                xgridLines.select('line')
                    .attr("x1", $$.__axis_rotated ? 0 : $$.xv)
                    .attr("x2", $$.__axis_rotated ? $$.width : $$.xv);
                xgridLines.select('text')
                    .attr("x", $$.__axis_rotated ? $$.width : 0)
                    .attr("y", $$.xv);
                mainBar
                    .attr('transform', null)
                    .attr("d", drawBar);
                mainLine
                    .attr('transform', null)
                    .attr("d", drawLine);
                mainArea
                    .attr('transform', null)
                    .attr("d", drawArea);
                mainCircle
                    .attr('transform', null)
                    .attr("cx", $$.__axis_rotated ? $$.circleY : $$.circleX)
                    .attr("cy", $$.__axis_rotated ? $$.circleX : $$.circleY);
                mainText
                    .attr('transform', null)
                    .attr('x', xForText)
                    .attr('y', yForText)
                    .style('fill-opacity', $$.opacityForText);
                mainRegion
                    .attr('transform', null);
                mainRegion.select('rect').filter($$.isRegionOnX)
                    .attr("x", $$.regionX)
                    .attr("width", $$.regionWidth);
                eventRectUpdate
                    .attr("x", $$.__axis_rotated ? 0 : rectX)
                    .attr("y", $$.__axis_rotated ? rectX : 0)
                    .attr("width", $$.__axis_rotated ? $$.width : rectW)
                    .attr("height", $$.__axis_rotated ? rectW : $$.height);

                // callback for end of flow
                done();
            });
        });

        // update fadein condition
        $$.mapToIds($$.data.targets).forEach(function (id) {
            $$.withoutFadeIn[id] = true;
        });

        $$.updateZoom();
    };
    c3.fn.$$.redrawForBrush = function () {
        var $$ = this, x = $$.x;
        $$.redraw({
            withTransition: false,
            withY: false,
            withSubchart: false,
            withUpdateXDomain: true
        });
        $$.__subchart_onbrush.call(c3, x.orgDomain());
    };
    c3.fn.$$.redrawForZoom = function () {
        var $$ = this, d3 = $$.d3, zoom = $$.zoom, x = $$.x, orgXDomain = $$.orgXDomain;;
        if (!$$.__zoom_enabled) {
            return;
        }
        if ($$.filterTargetsToShow($$.data.targets).length === 0) {
            return;
        }
        if (d3.event.sourceEvent.type === 'mousemove' && zoom.altDomain) {
            x.domain(zoom.altDomain);
            zoom.scale(x).updateScaleExtent();
            return;
        }
        if ($$.isCategorized && x.orgDomain()[0] === orgXDomain[0]) {
            x.domain([orgXDomain[0] - 1e-10, x.orgDomain()[1]]);
        }
        $$.redraw({
            withTransition: false,
            withY: false,
            withSubchart: false
        });
        if (d3.event.sourceEvent.type === 'mousemove') {
            $$.cancelClick = true;
        }
        $$.__zoom_onzoom.call(c3, x.orgDomain());
    };
    c3.fn.$$.updateAndRedraw = function (options) {
        var $$ = this, transitions;
        options = options || {};
        // same with redraw
        options.withTransition = $$.getOption(options, "withTransition", true);
        options.withTransform = $$.getOption(options, "withTransform", false);
        options.withLegend = $$.getOption(options, "withLegend", false);
        // NOT same with redraw
        options.withUpdateXDomain = true;
        options.withUpdateOrgXDomain = true;
        options.withTransitionForExit = false;
        options.withTransitionForTransform = $$.getOption(options, "withTransitionForTransform", options.withTransition);
        // MEMO: this needs to be called before updateLegend and it means this ALWAYS needs to be called)
        this.updateSizes();
        // MEMO: called in updateLegend in redraw if withLegend
        if (!(options.withLegend && $$.__legend_show)) {
            transitions = $$.generateAxisTransitions(options.withTransitionForAxis ? $$.__transition_duration : 0);
            // Update scales
            $$.updateScales();
            $$.updateSvgSize();
            // Update g positions
            $$.transformAll(options.withTransitionForTransform, transitions);
        }
        // Draw with new sizes & scales
        $$.redraw(options, transitions);
    };

    c3.fn.$$.generateEventRectsForSingleX = function (eventRectEnter) {
        var $$ = this, d3 = $$.d3, CLASS = $$.CLASS;
        eventRectEnter.append("rect")
            .attr("class", function (d) { return $$.classEvent(d); })
            .style("cursor", $$.__data_selection_enabled && $$.__data_selection_grouped ? "pointer" : null)
            .on('mouseover', function (d) {
                var index = d.index, selectedData, newData;

                if ($$.dragging) { return; } // do nothing if dragging
                if ($$.hasArcType($$.data.targets)) { return; }

                selectedData = $$.data.targets.map(function (t) {
                    return $$.addName($$.getValueOnIndex(t.values, index));
                });

                // Sort selectedData as names order
                newData = [];
                Object.keys($$.__data_names).forEach(function (id) {
                    for (var j = 0; j < selectedData.length; j++) {
                        if (selectedData[j] && selectedData[j].id === id) {
                            newData.push(selectedData[j]);
                            selectedData.shift(j);
                            break;
                        }
                    }
                });
                selectedData = newData.concat(selectedData); // Add remained

                // Expand shapes for selection
                if ($$.__point_focus_expand_enabled) { $$.expandCircles(index); }
                $$.expandBars(index);

                // Call event handler
                $$.main.selectAll('.' + $$.CLASS.shape + '-' + index).each(function (d) {
                    $$.__data_onmouseover.call(c3, d);
                });
            })
            .on('mouseout', function (d) {
                var index = d.index;
                if ($$.hasArcType($$.data.targets)) { return; }
                $$.hideXGridFocus();
                $$.hideTooltip();
                // Undo expanded shapes
                $$.unexpandCircles(index);
                $$.unexpandBars();
                // Call event handler
                $$.main.selectAll('.' + CLASS.shape + '-' + index).each(function (d) {
                    $$.__data_onmouseout.call(c3, d);
                });
            })
            .on('mousemove', function (d) {
                var selectedData, index = d.index,
                    eventRect = $$.svg.select('.' + CLASS.eventRect + '-' + index);

                if ($$.dragging) { return; } // do nothing when dragging
                if ($$.hasArcType($$.data.targets)) { return; }

                // Show tooltip
                selectedData = $$.filterTargetsToShow($$.data.targets).map(function (t) {
                    return $$.addName($$.getValueOnIndex(t.values, index));
                });

                if ($$.__tooltip_grouped) {
                    $$.showTooltip(selectedData, d3.mouse(this));
                    $$.showXGridFocus(selectedData);
                }

                if ($$.__tooltip_grouped && (!$$.__data_selection_enabled || $$.__data_selection_grouped)) {
                    return;
                }

                $$.main.selectAll('.' + CLASS.shape + '-' + index)
                    .each(function () {
                        d3.select(this).classed(CLASS.EXPANDED, true);
                        if ($$.__data_selection_enabled) {
                            eventRect.style('cursor', $$.__data_selection_grouped ? 'pointer' : null);
                        }
                        if (!$$.__tooltip_grouped) {
                            $$.hideXGridFocus();
                            $$.hideTooltip();
                            if (!$$.__data_selection_grouped) {
                                $$.unexpandCircles(index);
                                $$.unexpandBars();
                            }
                        }
                    })
                    .filter(function (d) {
                        if (this.nodeName === 'circle') {
                            return $$.isWithinCircle(this, $$.pointSelectR(d));
                        }
                        else if (this.nodeName === 'path') {
                            return $$.isWithinBar(this);
                        }
                    })
                    .each(function (d) {
                        if ($$.__data_selection_enabled && ($$.__data_selection_grouped || $$.__data_selection_isselectable(d))) {
                            eventRect.style('cursor', 'pointer');
                        }
                        if (!$$.__tooltip_grouped) {
                            $$.showTooltip([d], d3.mouse(this));
                            $$.showXGridFocus([d]);
                            if ($$.__point_focus_expand_enabled) { $$.expandCircles(index, d.id); }
                            $$.expandBars(index, d.id);
                        }
                    });
            })
            .on('click', function (d) {
                var index = d.index;
                if ($$.hasArcType($$.data.targets)) { return; }
                if ($$.cancelClick) {
                    $$.cancelClick = false;
                    return;
                }
                $$.main.selectAll('.' + CLASS.shape + '-' + index).each(function (d) { $$.toggleShape(this, d, index); });
            })
            .call(
                d3.behavior.drag().origin(Object)
                    .on('drag', function () { $$.drag(d3.mouse(this)); })
                    .on('dragstart', function () { $$.dragstart(d3.mouse(this)); })
                    .on('dragend', function () { $$.dragend(); })
            )
            .on("dblclick.zoom", null);
    };

    c3.fn.$$.generateEventRectsForMultipleXs = function (eventRectEnter) {
        var $$ = this, CLASS = $$.CLASS, d3 = $$.d3;
        eventRectEnter.append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', $$.width)
            .attr('height', $$.height)
            .attr('class', CLASS.eventRect)
            .on('mouseout', function () {
                if ($$.hasArcType($$.data.targets)) { return; }
                $$.hideXGridFocus();
                $$.hideTooltip();
                $$.unexpandCircles();
            })
            .on('mousemove', function () {
                var targetsToShow = $$.filterTargetsToShow($$.data.targets);
                var mouse, closest, sameXData, selectedData;

                if ($$.dragging) { return; } // do nothing when dragging
                if ($$.hasArcType(targetsToShow)) { return; }

                mouse = d3.mouse(this);
                closest = $$.findClosestFromTargets(targetsToShow, mouse);

                if (! closest) { return; }

                if ($$.isScatterType(closest)) {
                    sameXData = [closest];
                } else {
                    sameXData = $$.filterSameX(targetsToShow, closest.x);
                }

                // show tooltip when cursor is close to some point
                selectedData = sameXData.map(function (d) {
                    return $$.addName(d);
                });
                $$.showTooltip(selectedData, mouse);

                // expand points
                if ($$.__point_focus_expand_enabled) {
                    $$.unexpandCircles();
                    $$.expandCircles(closest.index, closest.id);
                }

                // Show xgrid focus line
                $$.showXGridFocus(selectedData);

                // Show cursor as pointer if point is close to mouse position
                if ($$.dist(closest, mouse) < 100) {
                    $$.svg.select('.' + CLASS.eventRect).style('cursor', 'pointer');
                    if (!$$.mouseover) {
                        $$.__data_onmouseover.call(c3, closest);
                        $$.mouseover = true;
                    }
                } else {
                    $$.svg.select('.' + CLASS.eventRect).style('cursor', null);
                    $$.__data_onmouseout.call(c3, closest);
                    $$.mouseover = false;
                }
            })
            .on('click', function () {
                var targetsToShow = $$.filterTargetsToShow($$.data.targets);
                var mouse, closest;

                if ($$.hasArcType(targetsToShow)) { return; }

                mouse = d3.mouse(this);
                closest = $$.findClosestFromTargets(targetsToShow, mouse);

                if (! closest) { return; }

                // select if selection enabled
                if ($$.dist(closest, mouse) < 100) {
                    $$.main.select('.' + CLASS.circles + '-' + $$.getTargetSelectorSuffix(closest.id)).select('.' + CLASS.circle + '-' + closest.index).each(function () {
                        $$.toggleShape(this, closest, closest.index);
                    });
                }
            })
            .call(
                d3.behavior.drag().origin(Object)
                    .on('drag', function () { $$.drag(d3.mouse(this)); })
                    .on('dragstart', function () { $$.dragstart(d3.mouse(this)); })
                    .on('dragend', function () { $$.dragend(); })
            )
            .on("dblclick.zoom", null);
    };








    c3.fn.$$.initialOpacity = function (d) {
        var $$ = this;
        return d.value !== null && $$.withoutFadeIn[d.id] ? 1 : 0;
    };
    c3.fn.$$.opacityForCircle = function (d) {
        return this.isValue(d.value) ? this.isScatterType(d) ? 0.5 : 1 : 0;
    };
    c3.fn.$$.opacityForText = function () {
        return this.hasDataLabel() ? 1 : 0;
    };
    c3.fn.$$.xx = function (d) {
        var $$ = this;
        return d ? $$.x(d.x) : null;
    };
    c3.fn.$$.xv = function (d) {
        return Math.ceil($$.x($$.isTimeSeries ? this.parseDate(d.value) : d.value));
    };
    c3.fn.$$.yv = function (d) {
        var $$ = this,
            yScale = d.axis && d.axis === 'y2' ? $$.y2 : $$.y;
        return Math.ceil(yScale(d.value));
    };
    c3.fn.$$.subxx = function (d) {
        return d ? $$.subX(d.x) : null;
    };



    c3.fn.$$.transformMain = function (withTransition, transitions) {
        var $$ = this, xAxis, yAxis, y2Axis;
        if (transitions && transitions.axisX) {
            xAxis = transitions.axisX;
        } else {
            xAxis  = $$.main.select('.' + this.CLASS.axisX);
            if (withTransition) { xAxis = xAxis.transition(); }
        }
        if (transitions && transitions.axisY) {
            yAxis = transitions.axisY;
        } else {
            yAxis = $$.main.select('.' + this.CLASS.axisY);
            if (withTransition) { yAxis = yAxis.transition(); }
        }
        if (transitions && transitions.axisY2) {
            y2Axis = transitions.axisY2;
        } else {
            y2Axis = $$.main.select('.' + this.CLASS.axisY2);
            if (withTransition) { y2Axis = y2Axis.transition(); }
        }
        (withTransition ? $$.main.transition() : $$.main).attr("transform", $$.translate.main);
        xAxis.attr("transform", $$.translate.x);
        yAxis.attr("transform", $$.translate.y);
        y2Axis.attr("transform", $$.translate.y2);
        $$.main.select('.' + this.CLASS.chartArcs).attr("transform", $$.translate.arc);
    };
    c3.fn.$$.transformContext = function (withTransition, transitions) {
        var $$ = this.$$, subXAxis;
        if (transitions && transitions.axisSubX) {
            subXAxis = transitions.axisSubX;
        } else {
            subXAxis = $$.context.select('.' + this.CLASS.axisX);
            if (withTransition) { subXAxis = subXAxis.transition(); }
        }
        $$.context.attr("transform", $$.translate.context);
        subXAxis.attr("transform", $$.translate.subx);
    };
    c3.fn.$$.transformLegend = function (withTransition) {
        var $$ = this;
        (withTransition ? $$.legend.transition() : $$.legend).attr("transform", $$.translate.legend);
    };
    c3.fn.$$.transformAll = function (withTransition, transitions) {
        var $$ = this;
        $$.transformMain(withTransition, transitions);
        if ($$.__subchart_show) { $$.transformContext(withTransition, transitions); }
        $$.transformLegend(withTransition);
    };


    c3.fn.$$.updateSvgSize = function () {
        var $$ = this;
        $$.svg.attr('width', $$.currentWidth).attr('height', $$.currentHeight);
        $$.svg.select('#' + $$.clipId).select('rect')
            .attr('width', $$.width)
            .attr('height', $$.height);
        $$.svg.select('#' + $$.clipIdForXAxis).select('rect')
            .attr('x', function () { return $$.getXAxisClipX(); })
            .attr('y', function () { return $$.getXAxisClipY(); })
            .attr('width', function () { return $$.getXAxisClipWidth(); })
            .attr('height', function () { return $$.getXAxisClipHeight(); });
        $$.svg.select('#' + $$.clipIdForYAxis).select('rect')
            .attr('x', function () { return $$.getYAxisClipX(); })
            .attr('y', function () { return $$.getYAxisClipY(); })
            .attr('width', function () { return $$.getYAxisClipWidth(); })
            .attr('height', function () { return $$.getYAxisClipHeight(); });
        $$.svg.select('.' + $$.CLASS.zoomRect)
            .attr('width', $$.width)
            .attr('height', $$.height);
        // MEMO: parent div's height will be bigger than svg when <!DOCTYPE html>
        $$.selectChart.style('max-height', $$.currentHeight + "px");
    };


    c3.fn.$$.updateDimension = function () {
        var $$ = this;
        if ($$.__axis_rotated) {
            $$.axes.x.call($$.xAxis);
            $$.axes.subx.call($$.subXAxis);
        } else {
            $$.axes.y.call($$.yAxis);
            $$.axes.y2.call($$.y2Axis);
        }
        this.updateSizes();
        this.updateScales();
        this.updateSvgSize();
        this.transformAll(false);
    };

    c3.fn.$$.observeInserted = function (selection) {
        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === 'childList' && mutation.previousSibling) {
                    observer.disconnect();
                    // need to wait for completion of load because size calculation requires the actual sizes determined after that completion
                    var interval = window.setInterval(function () {
                        // parentNode will NOT be null when completed
                        if (selection.node().parentNode) {
                            window.clearInterval(interval);
                            this.updateDimension();
                            this.redraw({
                                withTransform: true,
                                withUpdateXDomain: true,
                                withUpdateOrgXDomain: true,
                                withTransition: false,
                                withTransitionForTransform: false,
                                withLegend: true
                            });
                            selection.transition().style('opacity', 1);
                        }
                    }, 10);
                }
            });
        });
        observer.observe(selection.node(), {attributes: true, childList: true, characterData: true});
    };


    c3.fn.$$.generateResize = function () {
        var resizeFunctions = [];
        function callResizeFunctions() {
            resizeFunctions.forEach(function (f) {
                f();
            });
        }
        callResizeFunctions.add = function (f) {
            resizeFunctions.push(f);
        };
        return callResizeFunctions;
    };



    c3.fn.$$.getCurrentWidth = function () {
        var $$ = this;
        return $$.__size_width ? $$.__size_width : $$.getParentWidth();
    };
    c3.fn.$$.getCurrentHeight = function () {
        var $$ = this, h = $$.__size_height ? $$.__size_height : this.getParentHeight();
        return h > 0 ? h : 320;
    };
    c3.fn.$$.getCurrentPaddingTop = function () {
        var $$ = this;
        return this.isValue($$.__padding_top) ? $$.__padding_top : 0;
    };
    c3.fn.$$.getCurrentPaddingBottom = function () {
        var $$ = this;
        return this.isValue($$.__padding_bottom) ? $$.__padding_bottom : 0;
    };
    c3.fn.$$.getCurrentPaddingLeft = function () {
        var $$ = this;
        if (this.isValue($$.__padding_left)) {
            return $$.__padding_left;
        } else if ($$.__axis_rotated) {
            return !$$.__axis_x_show ? 1 : Math.max(this.ceil10(this.getAxisWidthByAxisId('x')), 40);
        } else {
            return !$$.__axis_y_show || $$.__axis_y_inner ? 1 : this.ceil10(this.getAxisWidthByAxisId('y'));
        }
    };
    c3.fn.$$.getCurrentPaddingRight = function () {
        var $$ = this, defaultPadding = 10, legendWidthOnRight = $$.isLegendRight ? this.getLegendWidth() + 20 : 0;
        if (this.isValue($$.__padding_right)) {
            return $$.__padding_right + 1; // 1 is needed not to hide tick line
        } else if ($$.__axis_rotated) {
            return defaultPadding + legendWidthOnRight;
        } else {
            return (!$$.__axis_y2_show || $$.__axis_y2_inner ? defaultPadding : this.ceil10(this.getAxisWidthByAxisId('y2'))) + legendWidthOnRight;
        }
    };

    c3.fn.$$.getParentRectValue = function (key) {
        var $$ = this, parent = $$.selectChart.node(), v;
        while (parent && parent.tagName !== 'BODY') {
            v = parent.getBoundingClientRect()[key];
            if (v) {
                break;
            }
            parent = parent.parentNode;
        }
        return v;
    };
    c3.fn.$$.getParentWidth = function () {
        return this.getParentRectValue('width');
    };
    c3.fn.$$.getParentHeight = function () {
        var h = this.selectChart.style('height');
        return h.indexOf('px') > 0 ? +h.replace('px', '') : 0;
    };


    c3.fn.$$.getSvgLeft = function () {
        var $$ = this,
            leftAxisClass = $$.__axis_rotated ? $$.CLASS.axisX : $$.CLASS.axisY,
            leftAxis = $$.main.select('.' + leftAxisClass).node(),
            svgRect = leftAxis ? leftAxis.getBoundingClientRect() : {right: 0},
            chartRect = $$.selectChart.node().getBoundingClientRect(),
            hasArc = $$.hasArcType($$.data.targets),
            svgLeft = svgRect.right - chartRect.left - (hasArc ? 0 : $$.getCurrentPaddingLeft());
        return svgLeft > 0 ? svgLeft : 0;
    };


    c3.fn.$$.getAxisWidthByAxisId = function (id) {
        var position = this.getAxisLabelPositionById(id);
        return position.isInner ? 20 + this.getMaxTickWidth(id) : 40 + this.getMaxTickWidth(id);
    };
    c3.fn.$$.getHorizontalAxisHeight = function (axisId) {
        var $$ = this;
        if (axisId === 'x' && !$$.__axis_x_show) { return 0; }
        if (axisId === 'x' && $$.__axis_x_height) { return $$.__axis_x_height; }
        if (axisId === 'y' && !$$.__axis_y_show) { return $$.__legend_show && !$$.isLegendRight && !$$.isLegendInset ? 10 : 1; }
        if (axisId === 'y2' && !$$.__axis_y2_show) { return $$.rotated_padding_top; }
        return ($$.getAxisLabelPositionById(axisId).isInner ? 30 : 40) + (axisId === 'y2' ? -10 : 0);
    };

    c3.fn.$$.getEventRectWidth = function () {
        var $$ = this;
        var target = this.getMaxDataCountTarget($$.data.targets),
            firstData, lastData, base, maxDataCount, ratio, w;
        if (!target) {
            return 0;
        }
        firstData = target.values[0], lastData = target.values[target.values.length - 1];
        base = $$.x(lastData.x) - $$.x(firstData.x);
        if (base === 0) {
            return $$.__axis_rotated ? $$.height : $$.width;
        }
        maxDataCount = this.getMaxDataCount();
        ratio = (this.hasBarType($$.data.targets) ? (maxDataCount - (this.isCategorized ? 0.25 : 1)) / maxDataCount : 1);
        w = maxDataCount > 1 ? (base * ratio) / (maxDataCount - 1) : base;
        return w < 1 ? 1 : w;
    };


    /**
     *  c3.tooltip.js
     */
    c3.fn.$$.showTooltip = function (selectedData, mouse) {
        var $$ = this;
        var tWidth, tHeight, svgLeft, tooltipLeft, tooltipRight, tooltipTop, chartRight;
        var forArc = $$.hasArcType($$.data.targets),
            dataToShow = selectedData.filter(function (d) { return d && $$.isValue(d.value); });
        if (dataToShow.length === 0 || !$$.__tooltip_show) {
            return;
        }
        $$.tooltip.html($$.__tooltip_contents(selectedData, $$.getXAxisTickFormat(), $$.getYFormat(forArc), $$.color)).style("display", "block");

        // Get tooltip dimensions
        tWidth = $$.tooltip.property('offsetWidth');
        tHeight = $$.tooltip.property('offsetHeight');
        // Determin tooltip position
        if (forArc) {
            tooltipLeft = ($$.width / 2) + mouse[0];
            tooltipTop = ($$.height / 2) + mouse[1] + 20;
        } else {
            if ($$.__axis_rotated) {
                svgLeft = $$.getSvgLeft();
                tooltipLeft = svgLeft + mouse[0] + 100;
                tooltipRight = tooltipLeft + tWidth;
                chartRight = $$.getCurrentWidth() - $$.getCurrentPaddingRight();
                tooltipTop = $$.x(dataToShow[0].x) + 20;
            } else {
                svgLeft = $$.getSvgLeft();
                tooltipLeft = svgLeft + $$.getCurrentPaddingLeft() + $$.x(dataToShow[0].x) + 20;
                tooltipRight = tooltipLeft + tWidth;
                chartRight = svgLeft + $$.getCurrentWidth() - $$.getCurrentPaddingRight();
                tooltipTop = mouse[1] + 15;
            }

            if (tooltipRight > chartRight) {
                tooltipLeft -= tooltipRight - chartRight;
            }
            if (tooltipTop + tHeight > $$.getCurrentHeight()) {
                tooltipTop -= tHeight + 30;
            }
        }
        // Set tooltip
        $$.tooltip
            .style("top", tooltipTop + "px")
            .style("left", tooltipLeft + 'px');
    };
    c3.fn.$$.hideTooltip = function () {
        var $$ = this;
        $$.tooltip.style("display", "none");
    };

    
    /**
     *  c3.grid.js
     */
    c3.fn.$$.showXGridFocus = function (selectedData) {
        var $$ = this, dataToShow = selectedData.filter(function (d) { return d && $$.isValue(d.value); });
        if (! $$.__tooltip_show) { return; }
        // Hide when scatter plot exists
        if (this.hasScatterType($$.data.targets) || this.hasArcType($$.data.targets)) { return; }
        var focusEl = $$.main.selectAll('line.' + this.CLASS.xgridFocus);
        focusEl
            .style("visibility", "visible")
            .data([dataToShow[0]])
            .attr($$.__axis_rotated ? 'y1' : 'x1', function (d) { return $$.xx(d); })
            .attr($$.__axis_rotated ? 'y2' : 'x2', function (d) { return $$.xx(d); });
        this.smoothLines(focusEl, 'grid');
    };
    c3.fn.$$.hideXGridFocus = function () {
        var $$ = this;
        $$.main.select('line.' + $$.CLASS.xgridFocus).style("visibility", "hidden");
    };
    c3.fn.$$.updateXgridFocus = function () {
        var $$ = this;
        $$.main.select('line.' + this.CLASS.xgridFocus)
            .attr("x1", $$.__axis_rotated ? 0 : -10)
            .attr("x2", $$.__axis_rotated ? $$.width : -10)
            .attr("y1", $$.__axis_rotated ? -10 : 0)
            .attr("y2", $$.__axis_rotated ? -10 : $$.height);
    };
    c3.fn.$$.generateGridData = function (type, scale) {
        var gridData = [], xDomain, firstYear, lastYear, i,
            tickNum = $$.main.select("." + this.CLASS.axisX).selectAll('.tick').size();
        if (type === 'year') {
            xDomain = this.getXDomain();
            firstYear = xDomain[0].getFullYear();
            lastYear = xDomain[1].getFullYear();
            for (i = firstYear; i <= lastYear; i++) {
                gridData.push(new Date(i + '-01-01 00:00:00'));
            }
        } else {
            gridData = scale.ticks(10);
            if (gridData.length > tickNum) { // use only int
                gridData = gridData.filter(function (d) { return ("" + d).indexOf('.') < 0; });
            }
        }
        return gridData;
    };
    c3.fn.$$.getGridFilterToRemove = function (params) {
        return params ? function (line) {
            var found = false;
            [].concat(params).forEach(function (param) {
                if ((('value' in param && line.value === params.value) || ('class' in param && line.class === params.class))) {
                    found = true;
                }
            });
            return found;
        } : function () { return true; };
    };
    c3.fn.$$.removeGridLines = function (params, forX) {
        var $$ = this, CLASS = $$.CLASS,
            toRemove = $$.getGridFilterToRemove(params),
            toShow = function (line) { return !toRemove(line); },
            classLines = forX ? CLASS.xgridLines : CLASS.ygridLines,
            classLine = forX ? CLASS.xgridLine : CLASS.ygridLine;
        $$.main.select('.' + classLines).selectAll('.' + classLine).filter(toRemove)
            .transition().duration($$.__transition_duration)
            .style('opacity', 0).remove();
        if (forX) {
            $$.__grid_x_lines = $$.__grid_x_lines.filter(toShow);
        } else {
            $$.__grid_y_lines = $$.__grid_y_lines.filter(toShow);
        }
    };


    /**
     *  c3.legend.js
     */
    c3.fn.$$.updateLegendStep = function (step) {
        var $$ = this;
        $$.legendStep = step;
    };
    c3.fn.$$.updateLegendItemWidth = function (w) {
        var $$ = this;
        $$.legendItemWidth = w;
    };
    c3.fn.$$.updateLegendItemHeight = function (h) {
        var $$ = this;
        $$.legendItemHeight = h;
    };
    c3.fn.$$.getLegendWidth = function () {
        var $$ = this;
        return $$.__legend_show ? $$.isLegendRight || $$.isLegendInset ? $$.legendItemWidth * ($$.legendStep + 1) : $$.currentWidth : 0;
    };
    c3.fn.$$.getLegendHeight = function () {
        var $$ = this, h = 0;
        if ($$.__legend_show) {
            if ($$.isLegendRight) {
                h = $$.currentHeight;
            } else if ($$.isLegendInset) {
                h = $$.__legend_inset_step ? Math.max(20, $$.legendItemHeight) * ($$.__legend_inset_step + 1) : $$.height;
            } else {
                h = Math.max(20, $$.legendItemHeight) * ($$.legendStep + 1);
            }
        }
        return h;
    };
    c3.fn.$$.opacityForLegend = function (legendItem) {
        var $$ = this;
        return legendItem.classed($$.CLASS.legendItemHidden) ? $$.legendOpacityForHidden : 1;
    };
    c3.fn.$$.opacityForUnfocusedLegend = function (legendItem) {
        var $$ = this;
        return legendItem.classed($$.CLASS.legendItemHidden) ? $$.legendOpacityForHidden : 0.3;
    };
    c3.fn.$$.toggleFocusLegend = function (id, focus) {
        var $$ = this;
        $$.legend.selectAll('.' + $$.CLASS.legendItem)
          .transition().duration(100)
            .style('opacity', function (_id) {
                var This = $$.d3.select(this);
                if (id && _id !== id) {
                    return focus ? $$.opacityForUnfocusedLegend(This) : $$.opacityForLegend(This);
                } else {
                    return focus ? $$.opacityForLegend(This) : $$.opacityForUnfocusedLegend(This);
                }
            });
    };
    c3.fn.$$.revertLegend = function () {
        var $$ = this, d3 = $$.d3;
        $$.legend.selectAll('.' + $$.CLASS.legendItem)
          .transition().duration(100)
            .style('opacity', function () { return $$.opacityForLegend(d3.select(this)); });
    };
    c3.fn.$$.showLegend = function (targetIds) {
        var $$ = this;
        if (!$$.__legend_show) {
            $$.__legend_show = true;
            $$.legend.style('visibility', 'visible');
        }
        $$.removeHiddenLegendIds(targetIds);
        $$.legend.selectAll($$.selectorLegends(targetIds))
            .style('visibility', 'visible')
          .transition()
            .style('opacity', function () { return $$.opacityForLegend($$.d3.select(this)); });
    };
    c3.fn.$$.hideLegend = function (targetIds) {
        var $$ = this;
        if ($$.__legend_show && $$.isEmpty(targetIds)) {
            $$.__legend_show = false;
            $$.legend.style('visibility', 'hidden');
        }
        $$.addHiddenLegendIds(targetIds);
        $$.legend.selectAll($$.selectorLegends(targetIds))
            .style('opacity', 0)
            .style('visibility', 'hidden');
    };
    c3.fn.$$.updateLegend = function (targetIds, options, transitions) {
        var $$ = this;
        var xForLegend, xForLegendText, xForLegendRect, yForLegend, yForLegendText, yForLegendRect;
        var paddingTop = 4, paddingRight = 36, maxWidth = 0, maxHeight = 0, posMin = 10;
        var l, totalLength = 0, offsets = {}, widths = {}, heights = {}, margins = [0], steps = {}, step = 0;
        var withTransition, withTransitionForTransform;
        var hasFocused = $$.legend.selectAll('.' + $$.CLASS.legendItemFocused).size();
        var texts, rects, tiles;

        options = options || {};
        withTransition = $$.getOption(options, "withTransition", true);
        withTransitionForTransform = $$.getOption(options, "withTransitionForTransform", true);

        function updatePositions(textElement, id, reset) {
            var box = $$.getTextRect(textElement.textContent, $$.CLASS.legendItem),
                itemWidth = Math.ceil((box.width + paddingRight) / 10) * 10,
                itemHeight = Math.ceil((box.height + paddingTop) / 10) * 10,
                itemLength = $$.isLegendRight || $$.isLegendInset ? itemHeight : itemWidth,
                areaLength = $$.isLegendRight || $$.isLegendInset ? $$.getLegendHeight() : $$.getLegendWidth(),
                margin, maxLength;

            // MEMO: care about condifion of step, totalLength
            function updateValues(id, withoutStep) {
                if (!withoutStep) {
                    margin = (areaLength - totalLength - itemLength) / 2;
                    if (margin < posMin) {
                        margin = (areaLength - itemLength) / 2;
                        totalLength = 0;
                        step++;
                    }
                }
                steps[id] = step;
                margins[step] = $$.isLegendInset ? 10 : margin;
                offsets[id] = totalLength;
                totalLength += itemLength;
            }

            if (reset) {
                totalLength = 0;
                step = 0;
                maxWidth = 0;
                maxHeight = 0;
            }

            if ($$.__legend_show && !$$.isLegendToShow(id)) {
                widths[id] = heights[id] = steps[id] = offsets[id] = 0;
                return;
            }

            widths[id] = itemWidth;
            heights[id] = itemHeight;

            if (!maxWidth || itemWidth >= maxWidth) { maxWidth = itemWidth; }
            if (!maxHeight || itemHeight >= maxHeight) { maxHeight = itemHeight; }
            maxLength = $$.isLegendRight || $$.isLegendInset ? maxHeight : maxWidth;

            if ($$.__legend_equally) {
                Object.keys(widths).forEach(function (id) { widths[id] = maxWidth; });
                Object.keys(heights).forEach(function (id) { heights[id] = maxHeight; });
                margin = (areaLength - maxLength * targetIds.length) / 2;
                if (margin < posMin) {
                    totalLength = 0;
                    step = 0;
                    targetIds.forEach(function (id) { updateValues(id); });
                }
                else {
                    updateValues(id, true);
                }
            } else {
                updateValues(id);
            }
        }

        if ($$.isLegendRight) {
            xForLegend = function (id) { return maxWidth * steps[id]; };
            yForLegend = function (id) { return margins[steps[id]] + offsets[id]; };
        } else if ($$.isLegendInset) {
            xForLegend = function (id) { return maxWidth * steps[id] + 10; };
            yForLegend = function (id) { return margins[steps[id]] + offsets[id]; };
        } else {
            xForLegend = function (id) { return margins[steps[id]] + offsets[id]; };
            yForLegend = function (id) { return maxHeight * steps[id]; };
        }
        xForLegendText = function (id, i) { return xForLegend(id, i) + 14; };
        yForLegendText = function (id, i) { return yForLegend(id, i) + 9; };
        xForLegendRect = function (id, i) { return xForLegend(id, i) - 4; };
        yForLegendRect = function (id, i) { return yForLegend(id, i) - 7; };

        // Define g for legend area
        l = $$.legend.selectAll('.' + $$.CLASS.legendItem)
            .data(targetIds)
          .enter().append('g')
            .attr('class', function (id) { return $$.generateClass($$.CLASS.legendItem, id); })
            .style('visibility', function (id) { return $$.isLegendToShow(id) ? 'visible' : 'hidden'; })
            .style('cursor', 'pointer')
            .on('click', function (id) {
                typeof $$.__legend_item_onclick === 'function' ? $$.__legend_item_onclick.call(c3, id) : $$.this.toggle(id);
            })
            .on('mouseover', function (id) {
                $$.d3.select(this).classed($$.CLASS.legendItemFocused, true);
                if (!$$.transiting) {
                    $$.this.focus(id);
                }
                if (typeof $$.__legend_item_onmouseover === 'function') {
                    $$.__legend_item_onmouseover.call(c3, id);
                }
            })
            .on('mouseout', function (id) {
                $$.d3.select(this).classed($$.CLASS.legendItemFocused, false);
                if (!$$.transiting) {
                    $$.this.revert();
                }
                if (typeof $$.__legend_item_onmouseout === 'function') {
                    $$.__legend_item_onmouseout.call(c3, id);
                }
            });
        l.append('text')
            .text(function (id) { return $$.isDefined($$.__data_names[id]) ? $$.__data_names[id] : id; })
            .each(function (id, i) { updatePositions(this, id, i === 0); })
            .style("pointer-events", "none")
            .attr('x', $$.isLegendRight || $$.isLegendInset ? xForLegendText : -200)
            .attr('y', $$.isLegendRight || $$.isLegendInset ? -200 : yForLegendText);
        l.append('rect')
            .attr("class", $$.CLASS.legendItemEvent)
            .style('fill-opacity', 0)
            .attr('x', $$.isLegendRight || $$.isLegendInset ? xForLegendRect : -200)
            .attr('y', $$.isLegendRight || $$.isLegendInset ? -200 : yForLegendRect);
        l.append('rect')
            .attr("class", $$.CLASS.legendItemTile)
            .style("pointer-events", "none")
            .style('fill', $$.color)
            .attr('x', $$.isLegendRight || $$.isLegendInset ? xForLegendText : -200)
            .attr('y', $$.isLegendRight || $$.isLegendInset ? -200 : yForLegend)
            .attr('width', 10)
            .attr('height', 10);
        // Set background for inset legend
        if ($$.isLegendInset && maxWidth !== 0) {
            $$.legend.insert('g', '.' + $$.CLASS.legendItem)
                .attr("class", $$.CLASS.legendBackground)
              .append('rect')
                .attr('height', $$.getLegendHeight() - 10)
                .attr('width', maxWidth * (step + 1) + 10);
        }

        texts = $$.legend.selectAll('text')
            .data(targetIds)
            .text(function (id) { return $$.isDefined($$.__data_names[id]) ? $$.__data_names[id] : id; }) // MEMO: needed for update
            .each(function (id, i) { updatePositions(this, id, i === 0); });
        (withTransition ? texts.transition() : texts)
            .attr('x', xForLegendText)
            .attr('y', yForLegendText);

        rects = $$.legend.selectAll('rect.' + $$.CLASS.legendItemEvent)
            .data(targetIds);
        (withTransition ? rects.transition() : rects)
            .attr('width', function (id) { return widths[id]; })
            .attr('height', function (id) { return heights[id]; })
            .attr('x', xForLegendRect)
            .attr('y', yForLegendRect);

        tiles = $$.legend.selectAll('rect.' + $$.CLASS.legendItemTile)
            .data(targetIds);
        (withTransition ? tiles.transition() : tiles)
            .style('fill', $$.color)
            .attr('x', xForLegend)
            .attr('y', yForLegend);

        // toggle legend state
        $$.legend.selectAll('.' + $$.CLASS.legendItem)
            .classed($$.CLASS.legendItemHidden, function (id) { return !$$.isTargetToShow(id); })
            .transition()
            .style('opacity', function (id) {
                var This = $$.d3.select(this);
                if ($$.isTargetToShow(id)) {
                    return !hasFocused || This.classed($$.CLASS.legendItemFocused) ? $$.opacityForLegend(This) : $$.opacityForUnfocusedLegend(This);
                } else {
                    return $$.legendOpacityForHidden;
                }
            });

        // Update all to reflect change of legend
        $$.updateLegendItemWidth(maxWidth);
        $$.updateLegendItemHeight(maxHeight);
        $$.updateLegendStep(step);
        // Update size and scale
        $$.updateSizes();
        $$.updateScales();
        $$.updateSvgSize();
        // Update g positions
        $$.transformAll(withTransitionForTransform, transitions);
    };




    c3.fn.$$.getClipPath = function (id) {
        var isIE9 = window.navigator.appVersion.toLowerCase().indexOf("msie 9.") >= 0;
        return "url(" + (isIE9 ? "" : document.URL.split('#')[0]) + "#" + id + ")";
    };
    c3.fn.$$.getAxisClipX = function (forHorizontal) {
        var $$ = this;
        // axis line width + padding for left
        return forHorizontal ? -(1 + 30) : -($$.margin.left - 1);
    };
    c3.fn.$$.getAxisClipY = function (forHorizontal) {
        return forHorizontal ? -20 : -4;
    };
    c3.fn.$$.getXAxisClipX = function () {
        var $$ = this;
        return $$.getAxisClipX(!$$.__axis_rotated);
    };
    c3.fn.$$.getXAxisClipY = function () {
        var $$ = this;
        return this.getAxisClipY(!$$.__axis_rotated);
    };
    c3.fn.$$.getYAxisClipX = function () {
        var $$ = this;
        return this.getAxisClipX($$.__axis_rotated);
    };
    c3.fn.$$.getYAxisClipY = function () {
        var $$ = this;
        return this.getAxisClipY($$.__axis_rotated);
    };
    c3.fn.$$.getAxisClipWidth = function (forHorizontal) {
        var $$ = this;
        // width + axis line width + padding for left/right
        return forHorizontal ? $$.width + 2 + 30 + 30 : $$.margin.left + 20;
    };
    c3.fn.$$.getAxisClipHeight = function (forHorizontal) {
        var $$ = this;
        return forHorizontal ? ($$.__axis_x_height ? $$.__axis_x_height : 0) + 80 : $$.height + 8;
    };
    c3.fn.$$.getXAxisClipWidth = function () {
        var $$ = this;
        return this.getAxisClipWidth(!$$.__axis_rotated);
    };
    c3.fn.$$.getXAxisClipHeight = function () {
        var $$ = this;
        return this.getAxisClipHeight(!$$.__axis_rotated);
    };
    c3.fn.$$.getYAxisClipWidth = function () {
        var $$ = this;
        return this.getAxisClipWidth($$.__axis_rotated);
    };
    c3.fn.$$.getYAxisClipHeight = function () {
        var $$ = this;
        return this.getAxisClipHeight($$.__axis_rotated);
    };


    /**
     *  $$.data.js
     */
    c3.fn.$$.isX = function (key) {
        var $$ = this;
        return ($$.__data_x && key === $$.__data_x) || (this.notEmpty($$.__data_xs) && this.hasValue($$.__data_xs, key));
    };
    c3.fn.$$.isNotX = function (key) {
        return !this.isX(key);
    };
    c3.fn.$$.getXKey = function (id) {
        var $$ = this;
        return $$.__data_x ? $$.__data_x : this.notEmpty($$.__data_xs) ? $$.__data_xs[id] : null;
    };
    c3.fn.$$.getXValuesOfXKey = function (key, targets) {
        var xValues, ids = targets && this.notEmpty(targets) ? mapToIds(targets) : [];
        ids.forEach(function (id) {
            if (this.getXKey(id) === key) {
                xValues = $$.data.xs[id];
            }
        });
        return xValues;
    };
    c3.fn.$$.getXValue = function (id, i) {
        return id in $$.data.xs && $$.data.xs[id] && this.isValue($$.data.xs[id][i]) ? $$.data.xs[id][i] : i;
    };
    c3.fn.$$.getOtherTargetXs = function () {
        var idsForX = Object.keys($$.data.xs);
        return idsForX.length ? $$.data.xs[idsForX[0]] : null;
    };
    c3.fn.$$.getOtherTargetX = function (index) {
        var xs = this.getOtherTargetXs();
        return xs && index < xs.length ? xs[index] : null;
    };
    c3.fn.$$.addXs = function (xs) {
        Object.keys(xs).forEach(function (id) {
            $$.__data_xs[id] = xs[id];
        });
    };
    c3.fn.$$.isSingleX = function (xs) {
        return $$.d3.set(Object.keys(xs).map(function (id) { return xs[id]; })).size() === 1;
    };
    c3.fn.$$.addName = function (data) {
        var $$ = this, name;
        if (data) {
            name = $$.__data_names[data.id];
            data.name = name ? name : data.id;
        }
        return data;
    };
    c3.fn.$$.getValueOnIndex = function (values, index) {
        var valueOnIndex = values.filter(function (v) { return v.index === index; });
        return valueOnIndex.length ? valueOnIndex[0] : null;
    };
    c3.fn.$$.updateTargetX = function (targets, x) {
        targets.forEach(function (t) {
            t.values.forEach(function (v, i) {
                v.x = generateTargetX(x[i], t.id, i);
            });
            $$.data.xs[t.id] = x;
        });
    };
    c3.fn.$$.updateTargetXs = function (targets, xs) {
        targets.forEach(function (t) {
            if (xs[t.id]) {
                this.updateTargetX([t], xs[t.id]);
            }
        });
    };
    c3.fn.$$.generateTargetX = function (rawX, id, index) {
        var $$ = this, x;
        if ($$.isTimeSeries) {
            x = rawX ? $$.parseDate(rawX) : $$.parseDate($$.getXValue(id, index));
        }
        else if ($$.isCustomX() && !$$.isCategorized) {
            x = $$.isValue(rawX) ? +rawX : $$.getXValue(id, index);
        }
        else {
            x = index;
        }
        return x;
    };
    c3.fn.$$.convertUrlToData = function (url, mimeType, keys, done) {
        var type = mimeType ? mimeType : 'csv';
        $$.d3.xhr(url, function (error, data) {
            var d;
            if (type === 'json') {
                d = this.convertJsonToData(JSON.parse(data.response), keys);
            } else {
                d = this.convertCsvToData(data.response);
            }
            done(d);
        });
    };
    c3.fn.$$.cloneTarget = function (target) {
        return {
            id : target.id,
            id_org : target.id_org,
            values : target.values.map(function (d) {
                return {x: d.x, value: d.value, id: d.id};
            })
        };
    };
    c3.fn.$$.getPrevX = function (i) {
        var value = this.getValueOnIndex($$.data.targets[0].values, i - 1);
        return value ? value.x : null;
    };
    c3.fn.$$.getNextX = function (i) {
        var value = this.getValueOnIndex($$.data.targets[0].values, i + 1);
        return value ? value.x : null;
    };
    c3.fn.$$.getMaxDataCount = function () {
        var $$ = this;
        return $$.d3.max($$.data.targets, function (t) { return t.values.length; });
    };
    c3.fn.$$.getMaxDataCountTarget = function (targets) {
        var length = targets.length, max = 0, maxTarget;
        if (length > 1) {
            targets.forEach(function (t) {
                if (t.values.length > max) {
                    maxTarget = t;
                    max = t.values.length;
                }
            });
        } else {
            maxTarget = length ? targets[0] : null;
        }
        return maxTarget;
    };
    c3.fn.$$.getEdgeX = function (targets) {
        var target = this.getMaxDataCountTarget(targets), firstData, lastData;
        if (!target) {
            return [0, 0];
        }
        firstData = target.values[0], lastData = target.values[target.values.length - 1];
        return [firstData.x, lastData.x];
    };
    c3.fn.$$.mapToIds = function (targets) {
        return targets.map(function (d) { return d.id; });
    };
    c3.fn.$$.mapToTargetIds = function (ids) {
        return ids ? (typeof ids === 'string' ? [ids] : ids) : mapToIds($$.data.targets);
    };
    c3.fn.$$.hasTarget = function (targets, id) {
        var ids = this.mapToIds(targets), i;
        for (i = 0; i < ids.length; i++) {
            if (ids[i] === id) {
                return true;
            }
        }
        return false;
    };
    c3.fn.$$.isTargetToShow = function (targetId) {
        return this.hiddenTargetIds.indexOf(targetId) < 0;
    };
    c3.fn.$$.isLegendToShow = function (targetId) {
        return this.hiddenLegendIds.indexOf(targetId) < 0;
    };
    c3.fn.$$.filterTargetsToShow = function (targets) {
        var $$ = this;
        return targets.filter(function (t) { return $$.isTargetToShow(t.id); });
    };
    c3.fn.$$.mapTargetsToUniqueXs = function (targets) {
        var $$ = this;
        var xs = $$.d3.set($$.d3.merge(targets.map(function (t) { return t.values.map(function (v) { return v.x; }); }))).values();
        return $$.isTimeSeries ? xs.map(function (x) { return new Date(x); }) : xs.map(function (x) { return +x; });
    };
    c3.fn.$$.addHiddenTargetIds = function (targetIds) {
        var $$ = this;
        $$.hiddenTargetIds = $$.hiddenTargetIds.concat(targetIds);
    };
    c3.fn.$$.removeHiddenTargetIds = function (targetIds) {
        var $$ = this;
        $$.hiddenTargetIds = $$.hiddenTargetIds.filter(function (id) { return targetIds.indexOf(id) < 0; });
    };
    c3.fn.$$.addHiddenLegendIds = function (targetIds) {
        var $$ = this;
        $$.hiddenLegendIds = $$.hiddenLegendIds.concat(targetIds);
    };
    c3.fn.$$.removeHiddenLegendIds = function (targetIds) {
        var $$ = this;
        $$.hiddenLegendIds = $$.hiddenLegendIds.filter(function (id) { return targetIds.indexOf(id) < 0; });
    };
    c3.fn.$$.getValuesAsIdKeyed = function (targets) {
        var ys = {};
        targets.forEach(function (t) {
            ys[t.id] = [];
            t.values.forEach(function (v) {
                ys[t.id].push(v.value);
            });
        });
        return ys;
    };
    c3.fn.$$.checkValueInTargets = function (targets, checker) {
        var ids = Object.keys(targets), i, j, values;
        for (i = 0; i < ids.length; i++) {
            values = targets[ids[i]].values;
            for (j = 0; j < values.length; j++) {
                if (checker(values[j].value)) {
                    return true;
                }
            }
        }
        return false;
    };
    c3.fn.$$.hasNegativeValueInTargets = function (targets) {
        return this.checkValueInTargets(targets, function (v) { return v < 0; });
    };
    c3.fn.$$.hasPositiveValueInTargets = function (targets) {
        return this.checkValueInTargets(targets, function (v) { return v > 0; });
    };
    c3.fn.$$.isOrderDesc = function () {
        var $$ = this;
        return $$.__data_order && $$.__data_order.toLowerCase() === 'desc';
    };
    c3.fn.$$.isOrderAsc = function () {
        var $$ = this;
        return $$.__data_order && $$.__data_order.toLowerCase() === 'asc';
    };
    c3.fn.$$.orderTargets = function (targets) {
        var $$ = this, orderAsc = $$.isOrderAsc(), orderDesc = $$.isOrderDesc();
        if (orderAsc || orderDesc) {
            targets.sort(function (t1, t2) {
                var reducer = function (p, c) { return p + Math.abs(c.value); };
                var t1Sum = t1.values.reduce(reducer, 0),
                    t2Sum = t2.values.reduce(reducer, 0);
                return orderAsc ? t2Sum - t1Sum : t1Sum - t2Sum;
            });
        } else if (typeof $$.__data_order === 'function') {
            targets.sort($$.__data_order);
        } // TODO: accept name array for order
        return targets;
    };
    c3.fn.$$.filterSameX = function (targets, x) {
        return $$.d3.merge(targets.map(function (t) { return t.values; })).filter(function (v) { return v.x - x === 0; });
    };
    c3.fn.$$.filterRemoveNull = function (data) {
        var $$ = this;
        return data.filter(function (d) { return $$.isValue(d.value); });
    };
    c3.fn.$$.hasDataLabel = function () {
        var $$ = this;
        if (typeof $$.__data_labels === 'boolean' && $$.__data_labels) {
            return true;
        } else if (typeof $$.__data_labels === 'object' && this.notEmpty($$.__data_labels)) {
            return true;
        }
        return false;
    };
    c3.fn.$$.getDataLabelLength = function (min, max, axisId, key) {
        var lengths = [0, 0], paddingCoef = 1.3;
        $$.selectChart.select('svg').selectAll('.dummy')
            .data([min, max])
          .enter().append('text')
            .text(function (d) { return this.formatByAxisId(axisId)(d); })
            .each(function (d, i) {
                lengths[i] = this.getBoundingClientRect()[key] * paddingCoef;
            })
          .remove();
        return lengths;
    };
    c3.fn.$$.isNoneArc = function (d) {
        var $$ = this;
        return $$.hasTarget($$.data.targets, d.id);
    };
    c3.fn.$$.isArc = function (d) {
        var $$ = this;
        return 'data' in d && $$.hasTarget($$.data.targets, d.data.id);
    };


    /**
     *  c3.data.convert.js
     */
    c3.fn.$$.convertCsvToData = function (csv) {
        var rows = $$.d3.csv.parseRows(csv), d;
        if (rows.length === 1) {
            d = [{}];
            rows[0].forEach(function (id) {
                d[0][id] = null;
            });
        } else {
            d = $$.d3.csv.parse(csv);
        }
        return d;
    };
    c3.fn.$$.convertJsonToData = function (json, keys) {
        var new_rows = [], targetKeys, data;
        if (keys) { // when keys specified, json would be an array that includes objects
            targetKeys = keys.value;
            if (keys.x) {
                targetKeys.push(keys.x);
                $$.__data_x = keys.x;
            }
            new_rows.push(targetKeys);
            json.forEach(function (o) {
                var new_row = [];
                targetKeys.forEach(function (key) {
                    // convert undefined to null because undefined data will be removed in convertDataToTargets()
                    var v = typeof o[key] === 'undefined' ? null : o[key];
                    new_row.push(v);
                });
                new_rows.push(new_row);
            });
            data = this.convertRowsToData(new_rows);
        } else {
            Object.keys(json).forEach(function (key) {
                new_rows.push([key].concat(json[key]));
            });
            data = this.convertColumnsToData(new_rows);
        }
        return data;
    };
    c3.fn.$$.convertRowsToData = function (rows) {
        var keys = rows[0], new_row = {}, new_rows = [], i, j;
        for (i = 1; i < rows.length; i++) {
            new_row = {};
            for (j = 0; j < rows[i].length; j++) {
                new_row[keys[j]] = rows[i][j];
            }
            new_rows.push(new_row);
        }
        return new_rows;
    };
    c3.fn.$$.convertColumnsToData = function (columns) {
        var new_rows = [], i, j, key;
        for (i = 0; i < columns.length; i++) {
            key = columns[i][0];
            for (j = 1; j < columns[i].length; j++) {
                if (this.isUndefined(new_rows[j - 1])) {
                    new_rows[j - 1] = {};
                }
                new_rows[j - 1][key] = columns[i][j];
            }
        }
        return new_rows;
    };
    c3.fn.$$.convertDataToTargets = function (data, appendXs) {
        var $$ = this;
        var ids = $$.d3.keys(data[0]).filter($$.isNotX, $$),
            xs = $$.d3.keys(data[0]).filter($$.isX, $$),
            targets;

        // save x for update data by load when custom x and c3.x API
        ids.forEach(function (id) {
            var xKey = $$.getXKey(id);

            if ($$.isCustomX() || $$.isTimeSeries) {
                // if included in input data
                if (xs.indexOf(xKey) >= 0) {
                    $$.data.xs[id] = (appendXs && $$.data.xs[id] ? $$.data.xs[id] : []).concat(
                        data.map(function (d) { return d[xKey]; })
                            .filter(this.isValue)
                            .map(function (rawX, i) { return this.generateTargetX(rawX, id, i); })
                    );
                }
                // if not included in input data, find from preloaded data of other id's x
                else if ($$.__data_x) {
                    $$.data.xs[id] = this.getOtherTargetXs();
                }
                // if not included in input data, find from preloaded data
                else if (this.notEmpty($$.__data_xs)) {
                    $$.data.xs[id] = this.getXValuesOfXKey(xKey, $$.data.targets);
                }
                // MEMO: if no x included, use same x of current will be used
            } else {
                $$.data.xs[id] = data.map(function (d, i) { return i; });
            }
        }, this);

        // check x is defined
        ids.forEach(function (id) {
            if (!$$.data.xs[id]) {
                throw new Error('x is not defined for id = "' + id + '".');
            }
        });

        // convert to target
        targets = ids.map(function (id, index) {
            var convertedId = $$.__data_id_converter(id);
            return {
                id: convertedId,
                id_org: id,
                values: data.map(function (d, i) {
                    var xKey = $$.getXKey(id), rawX = d[xKey], x = $$.generateTargetX(rawX, id, i);
                    // use x as categories if custom x and categorized
                    if ($$.isCustomX() && $$.isCategorized && index === 0 && rawX) {
                        if (i === 0) { $$.__axis_x_categories = []; }
                        $$.__axis_x_categories.push(rawX);
                    }
                    // mark as x = undefined if value is undefined and filter to remove after mapped
                    if (typeof d[id] === 'undefined' || $$.data.xs[id].length <= i) {
                        x = undefined;
                    }
                    return {x: x, value: d[id] !== null && !isNaN(d[id]) ? +d[id] : null, id: convertedId};
                }).filter(function (v) { return typeof v.x !== 'undefined'; })
            };
        });

        // finish targets
        targets.forEach(function (t) {
            var i;
            // sort values by its x
            t.values = t.values.sort(function (v1, v2) {
                var x1 = v1.x || v1.x === 0 ? v1.x : Infinity,
                    x2 = v2.x || v2.x === 0 ? v2.x : Infinity;
                return x1 - x2;
            });
            // indexing each value
            i = 0;
            t.values.forEach(function (v) {
                v.index = i++;
            });
            // this needs to be sorted because its index and value.index is identical
            $$.data.xs[t.id].sort(function (v1, v2) {
                return v1 - v2;
            });
        });

        // set target types
        if ($$.__data_type) {
            this.setTargetType(this.mapToIds(targets).filter(function (id) { return ! (id in $$.__data_types); }), $$.__data_type);
        }

        // cache as original id keyed
        targets.forEach(function (d) {
            $$.addCache(d.id_org, d);
        });

        return targets;
    };

    /**
     *  c3.data.load.js
     */
    c3.fn.$$.load = function (targets, args) {
        var $$ = this;
        if (targets) {
            // filter loading targets if needed
            if (args.filter) {
                targets = targets.filter(args.filter);
            }
            // set type if args.types || args.type specified
            if (args.type || args.types) {
                targets.forEach(function (t) {
                    $$.setTargetType(t.id, args.types ? args.types[t.id] : args.type);
                });
            }
            // Update/Add data
            $$.data.targets.forEach(function (d) {
                for (var i = 0; i < targets.length; i++) {
                    if (d.id === targets[i].id) {
                        d.values = targets[i].values;
                        targets.splice(i, 1);
                        break;
                    }
                }
            });
            $$.data.targets = $$.data.targets.concat(targets); // add remained
        }

        // Set targets
        $$.updateTargets($$.data.targets);

        // Redraw with new targets
        $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true, withLegend: true});

        if (typeof args.done === 'function') {
            args.done();
        }
    };
    c3.fn.$$.loadFromArgs = function (args) {
        var $$ = this;
        if (args.data) {
            $$.load($$.convertDataToTargets(args.data), args);
        }
        else if (args.url) {
            $$.convertUrlToData(args.url, args.mimeType, args.keys, function (data) {
                $$.load($$.convertDataToTargets(data), args);
            });
        }
        else if (args.json) {
            $$.load($$.convertDataToTargets($$.convertJsonToData(args.json, args.keys)), args);
        }
        else if (args.rows) {
            $$.load($$.convertDataToTargets($$.convertRowsToData(args.rows)), args);
        }
        else if (args.columns) {
            $$.load($$.convertDataToTargets($$.convertColumnsToData(args.columns)), args);
        }
        else {
            $$.load(null, args);
        }
    };
    c3.fn.$$.unload = function (targetIds, done) {
        var $$ = this;
        if (typeof done !== 'function') {
            done = function () {};
        }
        // filter existing target
        targetIds = targetIds.filter(function (id) { return $$.hasTarget($$.data.targets, id); });
        // If no target, call done and return
        if (!targetIds || targetIds.length === 0) {
            done();
            return;
        }
        $$.svg.selectAll(targetIds.map(function (id) { return $$.selectorTarget(id); }))
          .transition()
            .style('opacity', 0)
            .remove()
            .call($$.endall, done);
        targetIds.forEach(function (id) {
            // Reset fadein for future load
            $$.withoutFadeIn[id] = false;
            // Remove target's elements
            $$.legend.selectAll('.' + $$.CLASS.legendItem + $$.getTargetSelectorSuffix(id)).remove();
            // Remove target
            $$.data.targets = $$.data.targets.filter(function (t) {
                return t.id !== id;
            });
        });
    };


    /**
     *  c3.data.category.js
     */
    c3.fn.$$.categoryName = function (i) {
        var $$ = this;
        return i < $$.__axis_x_categories.length ? $$.__axis_x_categories[i] : i;
    };




    /**
     *  c3.shape.js
     */
    c3.fn.$$.getShapeIndices = function (typeFilter) {
        var $$ = this;
        var indices = {}, i = 0, j, k;
        $$.filterTargetsToShow($$.data.targets.filter(typeFilter, $$)).forEach(function (d) {
            for (j = 0; j < $$.__data_groups.length; j++) {
                if ($$.__data_groups[j].indexOf(d.id) < 0) { continue; }
                for (k = 0; k < $$.__data_groups[j].length; k++) {
                    if ($$.__data_groups[j][k] in indices) {
                        indices[d.id] = indices[$$.__data_groups[j][k]];
                        break;
                        }
                }
            }
            if ($$.isUndefined(indices[d.id])) { indices[d.id] = i++; }
        });
        indices.__max__ = i - 1;
        return indices;
    };
    c3.fn.$$.getShapeX = function (offset, targetsNum, indices, isSub) {
        var $$ = this, scale = isSub ? $$.subX : $$.x;
        return function (d) {
            var index = d.id in indices ? indices[d.id] : 0;
            return d.x || d.x === 0 ? scale(d.x) - offset * (targetsNum / 2 - index) : 0;
        };
    };
    c3.fn.$$.getShapeY = function (isSub) {
        var $$ = this;
        return function (d) {
            var scale = isSub ? $$.getSubYScale(d.id) : $$.getYScale(d.id);
            return scale(d.value);
        };
    };
    c3.fn.$$.getShapeOffset = function (typeFilter, indices, isSub) {
        var $$ = this,
            targets = $$.orderTargets($$.filterTargetsToShow($$.data.targets.filter(typeFilter, $$))),
            targetIds = targets.map(function (t) { return t.id; });
        return function (d, i) {
            var scale = isSub ? $$.getSubYScale(d.id) : $$.getYScale(d.id),
                y0 = scale(0), offset = y0;
            targets.forEach(function (t) {
                if (t.id === d.id || indices[t.id] !== indices[d.id]) { return; }
                if (targetIds.indexOf(t.id) < targetIds.indexOf(d.id) && t.values[i].value * d.value >= 0) {
                    offset += scale(t.values[i].value) - y0;
                }
            });
            return offset;
        };
    };

    c3.fn.$$.getInterpolate = function (d) {
        var $$ = this;
        return $$.isSplineType(d) ? "cardinal" : $$.isStepType(d) ? "step-after" : "linear";
    };


    c3.fn.$$.circleX = function (d) {
        var $$ = this;
        return d.x || d.x === 0 ? $$.x(d.x) : null;
    };
    c3.fn.$$.circleY = function (d, i) {
        var $$ = this, lineIndices = $$.getShapeIndices($$.isLineType), getPoint = $$.generateGetLinePoint(lineIndices);
        return $$.__data_groups.length > 0 ? getPoint(d, i)[0][1] : $$.getYScale(d.id)(d.value);
    };
    c3.fn.$$.getCircles = function (i, id) {
        var $$ = this, CLASS = $$.CLASS;
        return (id ? $$.main.selectAll('.' + CLASS.circles + $$.getTargetSelectorSuffix(id)) : $$.main).selectAll('.' + CLASS.circle + ($$.isValue(i) ? '-' + i : ''));
    };
    c3.fn.$$.expandCircles = function (i, id) {
        var $$ = this, CLASS = $$.CLASS;
        $$.getCircles(i, id)
            .classed(CLASS.EXPANDED, true)
            .attr('r', function (d) { return $$.pointExpandedR(d); });
    };
    c3.fn.$$.unexpandCircles = function (i) {
        var $$ = this, CLASS = $$.CLASS;
        $$.getCircles(i)
            .filter(function () { return $$.d3.select(this).classed(CLASS.EXPANDED); })
            .classed(CLASS.EXPANDED, false)
            .attr('r', function (d) { return $$.pointR(d); });
    };
    c3.fn.$$.pointR = function (d) {
        var $$ = this;
        return $$.__point_show && !$$.isStepType(d) ? (typeof $$.__point_r === 'function' ? $$.__point_r(d) : $$.__point_r) : 0;
    };
    c3.fn.$$.pointExpandedR = function (d) {
        var $$ = this;
        return $$.__point_focus_expand_enabled ? ($$.__point_focus_expand_r ? $$.__point_focus_expand_r : $$.pointR(d) * 1.75) : $$.pointR(d);
    };
    c3.fn.$$.pointSelectR = function (d) {
        var $$ = this;
        return $$.__point_select_r ? $$.__point_select_r : $$.pointR(d) * 4;
    };



    c3.fn.$$.getBarW = function (axis, barTargetsNum) {
        var $$ = this;
        return typeof $$.__bar_width === 'number' ? $$.__bar_width : barTargetsNum ? (axis.tickOffset() * 2 * $$.__bar_width_ratio) / barTargetsNum : 0;
    };
    c3.fn.$$.getBars = function (i) {
        var $$ = this;
        return $$.main.selectAll('.' + this.CLASS.bar + (this.isValue(i) ? '-' + i : ''));
    };
    c3.fn.$$.expandBars = function (i) {
        this.getBars(i).classed(this.CLASS.EXPANDED, true);
    };
    c3.fn.$$.unexpandBars = function (i) {
        this.getBars(i).classed(this.CLASS.EXPANDED, false);
    };
    c3.fn.$$.generateDrawBar = function (barIndices, isSub) {
        var $$ = this, getPoints = this.generateGetBarPoints(barIndices, isSub);
        return function (d, i) {
            // 4 points that make a bar
            var points = getPoints(d, i);

            // switch points if axis is rotated, not applicable for sub chart
            var indexX = $$.__axis_rotated ? 1 : 0;
            var indexY = $$.__axis_rotated ? 0 : 1;

            var path = 'M ' + points[0][indexX] + ',' + points[0][indexY] + ' ' +
                    'L' + points[1][indexX] + ',' + points[1][indexY] + ' ' +
                    'L' + points[2][indexX] + ',' + points[2][indexY] + ' ' +
                    'L' + points[3][indexX] + ',' + points[3][indexY] + ' ' +
                    'z';

            return path;
        };
    };
    c3.fn.$$.generateGetBarPoints = function (barIndices, isSub) {
        var $$ = this,
            barTargetsNum = barIndices.__max__ + 1,
            barW = $$.getBarW($$.xAxis, barTargetsNum),
            barX = $$.getShapeX(barW, barTargetsNum, barIndices, !!isSub),
            barY = $$.getShapeY(!!isSub),
            barOffset = $$.getShapeOffset($$.isBarType, barIndices, !!isSub),
            yScale = isSub ? $$.getSubYScale : $$.getYScale;
        return function (d, i) {
            var y0 = yScale.call($$, d.id)(0),
                offset = barOffset(d, i) || y0, // offset is for stacked bar chart
                posX = barX(d), posY = barY(d);
            // fix posY not to overflow opposite quadrant
            if ($$.__axis_rotated) {
                if ((0 < d.value && posY < y0) || (d.value < 0 && y0 < posY)) { posY = y0; }
            }
            // 4 points that make a bar
            return [
                [posX, offset],
                [posX, posY - (y0 - offset)],
                [posX + barW, posY - (y0 - offset)],
                [posX + barW, offset]
            ];
        };
    };

    c3.fn.$$.generateDrawArea = function (areaIndices, isSub) {
        var $$ = this, area = $$.d3.svg.area(),
            getPoint = $$.generateGetAreaPoint(areaIndices, isSub),
            yScaleGetter = isSub ? $$.getSubYScale : $$.getYScale,
            xValue = function (d) { return (isSub ? $$.subxx : $$.xx).call($$, d); },
            value0 = function (d, i) {
                return $$.__data_groups.length > 0 ? getPoint(d, i)[0][1] : yScaleGetter.call($$, d.id)(0);
            },
            value1 = function (d, i) {
                return $$.__data_groups.length > 0 ? getPoint(d, i)[1][1] : yScaleGetter.call($$, d.id)(d.value);
            };

        area = $$.__axis_rotated ? area.x0(value0).x1(value1).y(xValue) : area.x(xValue).y0(value0).y1(value1);

        return function (d) {
            var data = $$.filterRemoveNull(d.values), x0 = 0, y0 = 0, path;
            if ($$.isAreaType(d)) {
                path = area.interpolate($$.getInterpolate(d))(data);
            } else {
                if (data[0]) {
                    x0 = $$.x(data[0].x);
                    y0 = $$.getYScale(d.id)(data[0].value);
                }
                path = $$.__axis_rotated ? "M " + y0 + " " + x0 : "M " + x0 + " " + y0;
            }
            return path ? path : "M 0 0";
        };
    };

    c3.fn.$$.generateDrawLine = function (lineIndices, isSub) {
        var $$ = this, line = $$.d3.svg.line(),
            getPoint = $$.generateGetLinePoint(lineIndices, isSub),
            yScaleGetter = isSub ? $$.getSubYScale : $$.getYScale,
            xValue = function (d) { return (isSub ? $$.subxx : $$.xx).call($$, d); },
            yValue = function (d, i) {
                return $$.__data_groups.length > 0 ? getPoint(d, i)[0][1] : yScaleGetter.call($$, d.id)(d.value);
            };

        line = $$.__axis_rotated ? line.x(yValue).y(xValue) : line.x(xValue).y(yValue);
        if (!$$.__line_connect_null) { line = line.defined(function (d) { return d.value != null; }); }
        return function (d) {
            var data = $$.__line_connect_null ? $$.filterRemoveNull(d.values) : d.values,
                x = isSub ? $$.x : $$.subX, y = yScaleGetter.call($$, d.id), x0 = 0, y0 = 0, path;
            if ($$.isLineType(d)) {
                if ($$.__data_regions[d.id]) {
                    path = $$.lineWithRegions(data, x, y, $$.__data_regions[d.id]);
                } else {
                    path = line.interpolate($$.getInterpolate(d))(data);
                }
            } else {
                if (data[0]) {
                    x0 = x(data[0].x);
                    y0 = y(data[0].value);
                }
                path = $$.__axis_rotated ? "M " + y0 + " " + x0 : "M " + x0 + " " + y0;
            }
            return path ? path : "M 0 0";
        };
    };

    c3.fn.$$.generateXYForText = function (barIndices, forX) {
        var getPoints = this.generateGetBarPoints(barIndices, false),
            getter = forX ? this.getXForText : this.getYForText;
        return function (d, i) {
            return getter(getPoints(d, i), d, this);
        };
    };
    c3.fn.$$.getXForText = function (points, d, textElement) {
        var box = textElement.getBoundingClientRect(), xPos, padding;
        if ($$.__axis_rotated) {
            padding = this.isBarType(d) ? 4 : 6;
            xPos = points[2][1] + padding * (d.value < 0 ? -1 : 1);
        } else {
            xPos = points[0][0] + (points[2][0] - points[0][0]) / 2;
        }
        return xPos > $$.width ? $$.width - box.width : xPos;
    };
    c3.fn.$$.getYForText = function (points, d, textElement) {
        var box = textElement.getBoundingClientRect(), yPos;
        if ($$.__axis_rotated) {
            yPos = (points[0][0] + points[2][0] + box.height * 0.6) / 2;
        } else {
            yPos = points[2][1] + (d.value < 0 ? box.height : this.isBarType(d) ? -3 : -6);
        }
        return yPos < box.height ? box.height : yPos;
    };

    c3.fn.$$.generateGetAreaPoint = function (areaIndices, isSub) { // partial duplication of generateGetBarPoints
        var $$ = this,
            areaTargetsNum = areaIndices.__max__ + 1,
            x = $$.getShapeX(0, areaTargetsNum, areaIndices, !!isSub),
            y = $$.getShapeY(!!isSub),
            areaOffset = $$.getShapeOffset($$.isAreaType, areaIndices, !!isSub),
            yScale = isSub ? $$.getSubYScale : $$.getYScale;
        return function (d, i) {
            var y0 = yScale.call($$, d.id)(0),
                offset = areaOffset(d, i) || y0, // offset is for stacked area chart
                posX = x(d), posY = y(d);
            // fix posY not to overflow opposite quadrant
            if ($$.__axis_rotated) {
                if ((0 < d.value && posY < y0) || (d.value < 0 && y0 < posY)) { posY = y0; }
            }
            // 1 point that marks the area position
            return [
                [posX, offset],
                [posX, posY - (y0 - offset)]
            ];
        };
    };

    c3.fn.$$.generateGetLinePoint = function (lineIndices, isSub) { // partial duplication of generateGetBarPoints
        var $$ = this,
            lineTargetsNum = lineIndices.__max__ + 1,
            x = $$.getShapeX(0, lineTargetsNum, lineIndices, !!isSub),
            y = $$.getShapeY(!!isSub),
            lineOffset = $$.getShapeOffset($$.isLineType, lineIndices, !!isSub),
            yScale = isSub ? $$.getSubYScale : $$.getYScale;
        return function (d, i) {
            var y0 = yScale.call($$, d.id)(0),
                offset = lineOffset(d, i) || y0, // offset is for stacked area chart
                posX = x(d), posY = y(d);
            // fix posY not to overflow opposite quadrant
            if ($$.__axis_rotated) {
                if ((0 < d.value && posY < y0) || (d.value < 0 && y0 < posY)) { posY = y0; }
            }
            // 1 point that marks the line position
            return [
                [posX, posY - (y0 - offset)]
            ];
        };
    };


    c3.fn.$$.lineWithRegions = function (d, x, y, _regions) {
        var prev = -1, i, j;
        var s = "M", sWithRegion;
        var xp, yp, dx, dy, dd, diff, diffx2;
        var xValue, yValue;
        var regions = [];

        // Check start/end of regions
        if (this.isDefined(_regions)) {
            for (i = 0; i < _regions.length; i++) {
                regions[i] = {};
                if (this.isUndefined(_regions[i].start)) {
                    regions[i].start = d[0].x;
                } else {
                    regions[i].start = $$.isTimeSeries ? this.parseDate(_regions[i].start) : _regions[i].start;
                }
                if (this.isUndefined(_regions[i].end)) {
                    regions[i].end = d[d.length - 1].x;
                } else {
                    regions[i].end = $$.isTimeSeries ? this.parseDate(_regions[i].end) : _regions[i].end;
                }
            }
        }

        // Set scales
        xValue = $$.__axis_rotated ? function (d) { return y(d.value); } : function (d) { return x(d.x); };
        yValue = $$.__axis_rotated ? function (d) { return x(d.x); } : function (d) { return y(d.value); };

        // Define svg generator function for region
        if ($$.isTimeSeries) {
            sWithRegion = function (d0, d1, j, diff) {
                var x0 = d0.x.getTime(), x_diff = d1.x - d0.x,
                    xv0 = new Date(x0 + x_diff * j),
                    xv1 = new Date(x0 + x_diff * (j + diff));
                return "M" + x(xv0) + " " + y(yp(j)) + " " + x(xv1) + " " + y(yp(j + diff));
            };
        } else {
            sWithRegion = function (d0, d1, j, diff) {
                return "M" + x(xp(j), true) + " " + y(yp(j)) + " " + x(xp(j + diff), true) + " " + y(yp(j + diff));
            };
        }

        // Generate
        for (i = 0; i < d.length; i++) {

            // Draw as normal
            if (this.isUndefined(regions) || ! this.isWithinRegions(d[i].x, regions)) {
                s += " " + xValue(d[i]) + " " + yValue(d[i]);
            }
            // Draw with region // TODO: Fix for horizotal charts
            else {
                xp = this.getScale(d[i - 1].x, d[i].x, $$.isTimeSeries);
                yp = this.getScale(d[i - 1].value, d[i].value);

                dx = x(d[i].x) - x(d[i - 1].x);
                dy = y(d[i].value) - y(d[i - 1].value);
                dd = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
                diff = 2 / dd;
                diffx2 = diff * 2;

                for (j = diff; j <= 1; j += diffx2) {
                    s += sWithRegion(d[i - 1], d[i], j, diff);
                }
            }
            prev = d[i].x;
        }

        return s;
    };



    c3.fn.$$.isWithinCircle = function (_this, _r) {
        var mouse = $$.d3.mouse(_this), d3_this = $$.d3.select(_this);
        var cx = d3_this.attr("cx") * 1, cy = d3_this.attr("cy") * 1;
        return Math.sqrt(Math.pow(cx - mouse[0], 2) + Math.pow(cy - mouse[1], 2)) < _r;
    };
    c3.fn.$$.isWithinBar = function (_this) {
        var mouse = $$.d3.mouse(_this), box = _this.getBoundingClientRect(),
            seg0 = _this.pathSegList.getItem(0), seg1 = _this.pathSegList.getItem(1);
        var x = seg0.x, y = Math.min(seg0.y, seg1.y), w = box.width, h = box.height, offset = 2;
        var sx = x - offset, ex = x + w + offset, sy = y + h + offset, ey = y - offset;
        return sx < mouse[0] && mouse[0] < ex && ey < mouse[1] && mouse[1] < sy;
    };
    c3.fn.$$.isWithinRegions = function (x, regions) {
        var i;
        for (i = 0; i < regions.length; i++) {
            if (regions[i].start < x && x <= regions[i].end) { return true; }
        }
        return false;
    };




    c3.fn.$$.findSameXOfValues = function (values, index) {
        var i, targetX = values[index].x, sames = [];
        for (i = index - 1; i >= 0; i--) {
            if (targetX !== values[i].x) { break; }
            sames.push(values[i]);
        }
        for (i = index; i < values.length; i++) {
            if (targetX !== values[i].x) { break; }
            sames.push(values[i]);
        }
        return sames;
    };

    c3.fn.$$.findClosestOfValues = function (values, pos, _min, _max) { // MEMO: values must be sorted by x
        var min = _min ? _min : 0,
            max = _max ? _max : values.length - 1,
            med = Math.floor((max - min) / 2) + min,
            value = values[med],
            diff = $$.x(value.x) - pos[$$.__axis_rotated ? 1 : 0],
            candidates;

        // Update range for search
        diff > 0 ? max = med : min = med;

        // if candidates are two closest min and max, stop recursive call
        if ((max - min) === 1 || (min === 0 && max === 0)) {

            // Get candidates that has same min and max index
            candidates = [];
            if (values[min].x || values[min].x === 0) {
                candidates = candidates.concat(this.findSameXOfValues(values, min));
            }
            if (values[max].x || values[max].x === 0) {
                candidates = candidates.concat(this.findSameXOfValues(values, max));
            }

            // Determine the closest and return
            return this.findClosest(candidates, pos);
        }

        return this.findClosestOfValues(values, pos, min, max);
    };
    c3.fn.$$.findClosestFromTargets = function (targets, pos) {
        var candidates;

        // map to array of closest points of each target
        candidates = targets.map(function (target) {
            return this.findClosestOfValues(target.values, pos);
        });

        // decide closest point and return
        return this.findClosest(candidates, pos);
    };
    c3.fn.$$.findClosest = function (values, pos) {
        var minDist, closest;
        values.forEach(function (v) {
            var d = this.dist(v, pos);
            if (d < minDist || ! minDist) {
                minDist = d;
                closest = v;
            }
        });
        return closest;
    };
    c3.fn.$$.dist = function (data, pos) {
        var yScale = this.getAxisId(data.id) === 'y' ? $$.y : $$.y2,
            xIndex = $$.__axis_rotated ? 1 : 0,
            yIndex = $$.__axis_rotated ? 0 : 1;
        return Math.pow($$.x(data.x) - pos[xIndex], 2) + Math.pow(yScale(data.value) - pos[yIndex], 2);
    };


    c3.fn.$$.setTargetType = function (targetIds, type) {
        var $$ = this;
        $$.mapToTargetIds(targetIds).forEach(function (id) {
            $$.withoutFadeIn[id] = (type === $$.__data_types[id]);
            $$.__data_types[id] = type;
        });
        if (!targetIds) {
            $$.__data_type = type;
        }
    };
    c3.fn.$$.hasType = function (targets, type) {
        var $$ = this, has = false;
        targets.forEach(function (t) {
            if ($$.__data_types[t.id] === type) { has = true; }
            if (!(t.id in $$.__data_types) && type === 'line') { has = true; }
        });
        return has;
    };

    /* not used
     function hasLineType(targets) {
     return hasType(targets, 'line');
     }
     */
    c3.fn.$$.hasAreaType = function (targets) {
        return this.hasType(targets, 'area') || this.hasType(targets, 'area-spline') || this.hasType(targets, 'area-step');
    };
    c3.fn.$$.hasBarType = function (targets) {
        return this.hasType(targets, 'bar');
    };
    c3.fn.$$.hasScatterType = function (targets) {
        return this.hasType(targets, 'scatter');
    };
    c3.fn.$$.hasPieType = function (targets) {
        var $$ = this;
        return $$.__data_type === 'pie' || $$.hasType(targets, 'pie');
    };
    c3.fn.$$.hasGaugeType = function (targets) {
        return this.hasType(targets, 'gauge');
    };
    c3.fn.$$.hasDonutType = function (targets) {
        var $$ = this;
        return $$.__data_type === 'donut' || $$.hasType(targets, 'donut');
    };
    c3.fn.$$.hasArcType = function (targets) {
        return this.hasPieType(targets) || this.hasDonutType(targets) || this.hasGaugeType(targets);
    };
    c3.fn.$$.isLineType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return !$$.__data_types[id] || ['line', 'spline', 'area', 'area-spline', 'step', 'area-step'].indexOf($$.__data_types[id]) >= 0;
    };
    c3.fn.$$.isStepType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return ['step', 'area-step'].indexOf($$.__data_types[id]) >= 0;
    };
    c3.fn.$$.isSplineType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return ['spline', 'area-spline'].indexOf($$.__data_types[id]) >= 0;
    };
    c3.fn.$$.isAreaType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return ['area', 'area-spline', 'area-step'].indexOf($$.__data_types[id]) >= 0;
    };
    c3.fn.$$.isBarType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return $$.__data_types[id] === 'bar';
    };
    c3.fn.$$.isScatterType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return $$.__data_types[id] === 'scatter';
    };
    c3.fn.$$.isPieType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return $$.__data_types[id] === 'pie';
    };
    c3.fn.$$.isGaugeType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return $$.__data_types[id] === 'gauge';
    };
    c3.fn.$$.isDonutType = function (d) {
        var $$ = this, id = (typeof d === 'string') ? d : d.id;
        return $$.__data_types[id] === 'donut';
    };
    c3.fn.$$.isArcType = function (d) {
        return this.isPieType(d) || this.isDonutType(d) || this.isGaugeType(d);
    };
    c3.fn.$$.lineData = function (d) {
        return this.isLineType(d) ? [d] : [];
    };
    c3.fn.$$.arcData = function (d) {
        return this.isArcType(d.data) ? [d] : [];
    };
    /* not used
     function scatterData(d) {
     return isScatterType(d) ? d.values : [];
     }
     */
    c3.fn.$$.barData = function (d) {
        return this.isBarType(d) ? d.values : [];
    };
    c3.fn.$$.lineOrScatterData = function (d) {
        return this.isLineType(d) || this.isScatterType(d) ? d.values : [];
    };
    c3.fn.$$.barOrLineData = function (d) {
        return this.isBarType(d) || this.isLineType(d) ? d.values : [];
    };



    /**
     *  c3.date.js
     */
    c3.fn.$$.parseDate = function (date) {
        var parsedDate;
        if (date instanceof Date) {
            parsedDate = date;
        } else if (typeof date === 'number') {
            parsedDate = new Date(date);
        } else {
            parsedDate = this.dataTimeFormat($$.__data_x_format).parse(date);
        }
        if (!parsedDate || isNaN(+parsedDate)) {
            window.console.error("Failed to parse x '" + date + "' to Date object");
        }
        return parsedDate;
    };


    /**
     *  c3.color.js
     */
    c3.fn.$$.generateColor = function (colors, pattern, callback) {
        var ids = [];

        return function (d) {
            var id = d.id || d, color;

            // if callback function is provided
            if (colors[id] instanceof Function) {
                color = colors[id](d);
            }
            // if specified, choose that color
            else if (colors[id]) {
                color = colors[id];
            }
            // if not specified, choose from pattern
            else {
                if (ids.indexOf(id) < 0) { ids.push(id); }
                color = pattern[ids.indexOf(id) % pattern.length];
                colors[id] = color;
            }
            return callback instanceof Function ? callback(color, d) : color;
        };
    };
    c3.fn.$$.generateLevelColor = function (colors, threshold) {
        var asValue = threshold.unit === 'value',
            values = threshold.values && threshold.values.length ? threshold.values : [],
            max = threshold.max || 100;
        return function (value) {
            var i, v, color = colors[colors.length - 1];
            for (i = 0; i < values.length; i++) {
                v = asValue ? value : (value * 100 / max);
                if (v < values[i]) {
                    color = colors[i];
                    break;
                }
            }
            return color;
        };
    };


    /**
     *  c3.scale.js
     */
    c3.fn.$$.getScale = function (min, max, forTimeseries) {
        return (forTimeseries ? this.d3.time.scale() : this.d3.scale.linear()).range([min, max]);
    };
    c3.fn.$$.getX = function (min, max, domain, offset) {
        var $$ = this;
        var scale = this.getScale(min, max, $$.isTimeSeries),
            _scale = domain ? scale.domain(domain) : scale, key;
        // Define customized scale if categorized axis
        if ($$.isCategorized) {
            offset = offset || function () { return 0; };
            scale = function (d, raw) {
                var v = _scale(d) + offset(d);
                return raw ? v : Math.ceil(v);
            };
        } else {
            scale = function (d, raw) {
                var v = _scale(d);
                return raw ? v : Math.ceil(v);
            };
        }
        // define functions
        for (key in _scale) {
            scale[key] = _scale[key];
        }
        scale.orgDomain = function () {
            return _scale.domain();
        };
        // define custom domain() for categorized axis
        if ($$.isCategorized) {
            scale.domain = function (domain) {
                if (!arguments.length) {
                    domain = this.orgDomain();
                    return [domain[0], domain[1] + 1];
                }
                _scale.domain(domain);
                return scale;
            };
        }
        return scale;
    };
    c3.fn.$$.getY = function (min, max, domain) {
        var scale = this.getScale(min, max);
        if (domain) { scale.domain(domain); }
        return scale;
    };
    c3.fn.$$.getYScale = function (id) {
        var $$ = this;
        return $$.getAxisId(id) === 'y2' ? $$.y2 : $$.y;
    };
    c3.fn.$$.getSubYScale = function (id) {
        var $$ = this;
        return $$.getAxisId(id) === 'y2' ? $$.subY2 : $$.subY;
    };
    c3.fn.$$.updateScales = function () {
        var $$ = this, xAxisTickFormat, xAxisTickValues, forInit = !$$.x;
        // update edges
        $$.xMin = $$.__axis_rotated ? 1 : 0;
        $$.xMax = $$.__axis_rotated ? $$.height : $$.width;
        $$.yMin = $$.__axis_rotated ? 0 : $$.height;
        $$.yMax = $$.__axis_rotated ? $$.width : 1;
        $$.subXMin = $$.xMin;
        $$.subXMax = $$.xMax;
        $$.subYMin = $$.__axis_rotated ? 0 : $$.height2;
        $$.subYMax = $$.__axis_rotated ? $$.width2 : 1;
        // update scales
        $$.x = $$.getX($$.xMin, $$.xMax, forInit ? undefined : $$.x.orgDomain(), function () { return $$.xAxis.tickOffset(); });
        $$.y = $$.getY($$.yMin, $$.yMax, forInit ? undefined : $$.y.domain());
        $$.y2 = $$.getY($$.yMin, $$.yMax, forInit ? undefined : $$.y2.domain());
        $$.subX = $$.getX($$.xMin, $$.xMax, $$.orgXDomain, function (d) { return d % 1 ? 0 : $$.subXAxis.tickOffset(); });
        $$.subY = $$.getY($$.subYMin, $$.subYMax, forInit ? undefined : $$.subY.domain());
        $$.subY2 = $$.getY($$.subYMin, $$.subYMax, forInit ? undefined : $$.subY2.domain());
        // update axes
        $$.xAxisTickFormat = $$.getXAxisTickFormat();
        $$.xAxisTickValues = $$.__axis_x_tick_values ? $$.__axis_x_tick_values : (forInit ? undefined : $$.xAxis.tickValues());
        $$.xAxis = $$.getXAxis($$.x, $$.xOrient, $$.xAxisTickFormat, $$.xAxisTickValues);
        $$.subXAxis = $$.getXAxis($$.subX, $$.subXOrient, $$.xAxisTickFormat, $$.xAxisTickValues);
        $$.yAxis = $$.getYAxis($$.y, $$.yOrient, $$.__axis_y_tick_format, $$.__axis_y_ticks);
        $$.y2Axis = $$.getYAxis($$.y2, $$.y2Orient, $$.__axis_y2_tick_format, $$.__axis_y2_ticks);
        // Set initialized scales to brush and zoom
        if (!forInit) {
            $$.brush.scale($$.subX);
            if ($$.__zoom_enabled) { $$.zoom.scale($$.x); }
        }
        // update for arc
        this.updateArc();
    };
    c3.fn.$$.updateArc = function () {
        var $$ = this;
        $$.svgArc = this.getSvgArc();
        $$.svgArcExpanded = this.getSvgArcExpanded();
        $$.svgArcExpandedSub = this.getSvgArcExpanded(0.98);
    };


    /**
     *  c3.domain.js
     */
    c3.fn.$$.getYDomainMin = function (targets) {
        var $$ = this,
            ids = $$.mapToIds(targets), ys = $$.getValuesAsIdKeyed(targets),
            j, k, baseId, idsInGroup, id, hasNegativeValue;
        if ($$.__data_groups.length > 0) {
            hasNegativeValue = $$.hasNegativeValueInTargets(targets);
            for (j = 0; j < $$.__data_groups.length; j++) {
                // Determine baseId
                idsInGroup = $$.__data_groups[j].filter(function (id) { return ids.indexOf(id) >= 0; });
                if (idsInGroup.length === 0) { continue; }
                baseId = idsInGroup[0];
                // Consider negative values
                if (hasNegativeValue && ys[baseId]) {
                    ys[baseId].forEach(function (v, i) {
                        ys[baseId][i] = v < 0 ? v : 0;
                    });
                }
                // Compute min
                for (k = 1; k < idsInGroup.length; k++) {
                    id = idsInGroup[k];
                    if (! ys[id]) { continue; }
                    ys[id].forEach(function (v, i) {
                        if ($$.getAxisId(id) === $$.getAxisId(baseId) && ys[baseId] && !(hasNegativeValue && +v > 0)) {
                            ys[baseId][i] += +v;
                        }
                    });
                }
            }
        }
        return $$.d3.min(Object.keys(ys).map(function (key) { return $$.d3.min(ys[key]); }));
    };
    c3.fn.$$.getYDomainMax = function (targets) {
        var $$ = this,
            ids = $$.mapToIds(targets), ys = $$.getValuesAsIdKeyed(targets),
            j, k, baseId, idsInGroup, id, hasPositiveValue;
        if ($$.__data_groups.length > 0) {
            hasPositiveValue = $$.hasPositiveValueInTargets(targets);
            for (j = 0; j < $$.__data_groups.length; j++) {
                // Determine baseId
                idsInGroup = $$.__data_groups[j].filter(function (id) { return ids.indexOf(id) >= 0; });
                if (idsInGroup.length === 0) { continue; }
                baseId = idsInGroup[0];
                // Consider positive values
                if (hasPositiveValue && ys[baseId]) {
                    ys[baseId].forEach(function (v, i) {
                        ys[baseId][i] = v > 0 ? v : 0;
                    });
                }
                // Compute max
                for (k = 1; k < idsInGroup.length; k++) {
                    id = idsInGroup[k];
                    if (! ys[id]) { continue; }
                    ys[id].forEach(function (v, i) {
                        if ($$.getAxisId(id) === $$.getAxisId(baseId) && ys[baseId] && !(hasPositiveValue && +v < 0)) {
                            ys[baseId][i] += +v;
                        }
                    });
                }
            }
        }
        return $$.d3.max(Object.keys(ys).map(function (key) { return $$.d3.max(ys[key]); }));
    };
    c3.fn.$$.getYDomain = function (targets, axisId) {
        var $$ = this;
        var yTargets = targets.filter(function (d) { return $$.getAxisId(d.id) === axisId; }),
            yMin = axisId === 'y2' ? $$.__axis_y2_min : $$.__axis_y_min,
            yMax = axisId === 'y2' ? $$.__axis_y2_max : $$.__axis_y_max,
            yDomainMin = this.isValue(yMin) ? yMin : this.getYDomainMin(yTargets),
            yDomainMax = this.isValue(yMax) ? yMax : this.getYDomainMax(yTargets),
            domainLength, padding, padding_top, padding_bottom,
            center = axisId === 'y2' ? $$.__axis_y2_center : $$.__axis_y_center,
            yDomainAbs, lengths, diff, ratio, isAllPositive, isAllNegative,
            isZeroBased = (this.hasBarType(yTargets) && $$.__bar_zerobased) || (this.hasAreaType(yTargets) && $$.__area_zerobased),
            showHorizontalDataLabel = this.hasDataLabel() && $$.__axis_rotated,
            showVerticalDataLabel = this.hasDataLabel() && !$$.__axis_rotated;
        if (yTargets.length === 0) { // use current domain if target of axisId is none
            return axisId === 'y2' ? $$.y2.domain() : $$.y.domain();
        }
        if (yDomainMin === yDomainMax) {
            yDomainMin < 0 ? yDomainMax = 0 : yDomainMin = 0;
        }
        isAllPositive = yDomainMin >= 0 && yDomainMax >= 0;
        isAllNegative = yDomainMin <= 0 && yDomainMax <= 0;

        // Bar/Area chart should be 0-based if all positive|negative
        if (isZeroBased) {
            if (isAllPositive) { yDomainMin = 0; }
            if (isAllNegative) { yDomainMax = 0; }
        }

        domainLength = Math.abs(yDomainMax - yDomainMin);
        padding = padding_top = padding_bottom = domainLength * 0.1;

        if (center) {
            yDomainAbs = Math.max(Math.abs(yDomainMin), Math.abs(yDomainMax));
            yDomainMax = yDomainAbs - center;
            yDomainMin = center - yDomainAbs;
        }
        // add padding for data label
        if (showHorizontalDataLabel) {
            lengths = this.getDataLabelLength(yDomainMin, yDomainMax, axisId, 'width');
            diff = this.diffDomain($$.y.range());
            ratio = [lengths[0] / diff, lengths[1] / diff];
            padding_top += domainLength * (ratio[1] / (1 - ratio[0] - ratio[1]));
            padding_bottom += domainLength * (ratio[0] / (1 - ratio[0] - ratio[1]));
        } else if (showVerticalDataLabel) {
            lengths = this.getDataLabelLength(yDomainMin, yDomainMax, axisId, 'height');
            padding_top += lengths[1];
            padding_bottom += lengths[0];
        }
        if (axisId === 'y' && $$.__axis_y_padding) {
            padding_top = this.getAxisPadding($$.__axis_y_padding, 'top', padding, domainLength);
            padding_bottom = this.getAxisPadding($$.__axis_y_padding, 'bottom', padding, domainLength);
        }
        if (axisId === 'y2' && $$.__axis_y2_padding) {
            padding_top = this.getAxisPadding($$.__axis_y2_padding, 'top', padding, domainLength);
            padding_bottom = this.getAxisPadding($$.__axis_y2_padding, 'bottom', padding, domainLength);
        }
        // Bar/Area chart should be 0-based if all positive|negative
        if (isZeroBased) {
            if (isAllPositive) { padding_bottom = yDomainMin; }
            if (isAllNegative) { padding_top = -yDomainMax; }
        }
        return [yDomainMin - padding_bottom, yDomainMax + padding_top];
    };
    c3.fn.$$.getXDomainMin = function (targets) {
        var $$ = this;
        return $$.__axis_x_min ? ($$.isTimeSeries ? this.parseDate($$.__axis_x_min) : $$.__axis_x_min) : $$.d3.min(targets, function (t) { return $$.d3.min(t.values, function (v) { return v.x; }); });
    };
    c3.fn.$$.getXDomainMax = function (targets) {
        var $$ = this;
        return $$.__axis_x_max ? ($$.isTimeSeries ? this.parseDate($$.__axis_x_max) : $$.__axis_x_max) : $$.d3.max(targets, function (t) { return $$.d3.max(t.values, function (v) { return v.x; }); });
    };
    c3.fn.$$.getXDomainPadding = function (targets) {
        var $$ = this;
        var edgeX = this.getEdgeX(targets), diff = edgeX[1] - edgeX[0],
            maxDataCount, padding, paddingLeft, paddingRight;
        if ($$.isCategorized) {
            padding = 0;
        } else if (this.hasBarType(targets)) {
            maxDataCount = this.getMaxDataCount();
            padding = maxDataCount > 1 ? (diff / (maxDataCount - 1)) / 2 : 0.5;
        } else {
            padding = diff * 0.01;
        }
        if (typeof $$.__axis_x_padding === 'object' && this.notEmpty($$.__axis_x_padding)) {
            paddingLeft = this.isValue($$.__axis_x_padding.left) ? $$.__axis_x_padding.left : padding;
            paddingRight = this.isValue($$.__axis_x_padding.right) ? $$.__axis_x_padding.right : padding;
        } else if (typeof $$.__axis_x_padding === 'number') {
            paddingLeft = paddingRight = $$.__axis_x_padding;
        } else {
            paddingLeft = paddingRight = padding;
        }
        return {left: paddingLeft, right: paddingRight};
    };
    c3.fn.$$.getXDomain = function (targets) {
        var $$ = this;
        var xDomain = [this.getXDomainMin(targets), this.getXDomainMax(targets)],
            firstX = xDomain[0], lastX = xDomain[1],
            padding = this.getXDomainPadding(targets),
            min = 0, max = 0;
        // show center of x domain if min and max are the same
        if ((firstX - lastX) === 0 && !$$.isCategorized) {
            firstX = $$.isTimeSeries ? new Date(firstX.getTime() * 0.5) : -0.5;
            lastX = $$.isTimeSeries ? new Date(lastX.getTime() * 1.5) : 0.5;
        }
        if (firstX || firstX === 0) {
            min = $$.isTimeSeries ? new Date(firstX.getTime() - padding.left) : firstX - padding.left;
        }
        if (lastX || lastX === 0) {
            max = $$.isTimeSeries ? new Date(lastX.getTime() + padding.right) : lastX + padding.right;
        }
        return [min, max];
    };
    c3.fn.$$.updateXDomain = function (targets, withUpdateXDomain, withUpdateOrgXDomain, domain) {
        var $$ = this;
        if (withUpdateOrgXDomain) {
            $$.x.domain(domain ? domain : $$.d3.extent($$.getXDomain(targets)));
            $$.orgXDomain = $$.x.domain();
            if ($$.__zoom_enabled) { $$.zoom.scale($$.x).updateScaleExtent(); }
            $$.subX.domain($$.x.domain());
            $$.brush.scale($$.subX);
        }
        if (withUpdateXDomain) {
            $$.x.domain(domain ? domain : $$.brush.empty() ? $$.orgXDomain : $$.brush.extent());
            if ($$.__zoom_enabled) { $$.zoom.scale($$.x).updateScaleExtent(); }
        }
        return $$.x.domain();
    };




    c3.fn.$$.getXAxis = function (scale, orient, tickFormat, tickValues) {
        var $$ = this,
            axis = c3_axis($$.d3, $$.isCategorized).scale(scale).orient(orient);

        // Set tick
        axis.tickFormat(tickFormat).tickValues(tickValues);
        if ($$.isCategorized) {
            axis.tickCentered($$.__axis_x_tick_centered);
            if ($$.isEmpty($$.__axis_x_tick_culling)) {
                $$.__axis_x_tick_culling = false;
            }
        } else {
            // TODO: move this to c3_axis
            axis.tickOffset = function () {
                var edgeX = $$.getEdgeX($$.data.targets), diff = $$.x(edgeX[1]) - $$.x(edgeX[0]),
                    base = diff ? diff : ($$.__axis_rotated ? $$.height : $$.width);
                return (base / $$.getMaxDataCount()) / 2;
            };
        }

        return axis;
    };
    c3.fn.$$.getYAxis = function (scale, orient, tickFormat, ticks) {
        var $$ = this;
        return c3_axis($$.d3).scale(scale).orient(orient).tickFormat(tickFormat).ticks(ticks);
    };
    c3.fn.$$.getAxisId = function (id) {
        var $$ = this;
        return id in $$.__data_axes ? $$.__data_axes[id] : 'y';
    };
    c3.fn.$$.getXAxisTickFormat = function () {
        var $$ = this;
        var format = $$.isTimeSeries ? $$.defaultAxisTimeFormat : $$.isCategorized ? $$.categoryName : function (v) { return v < 0 ? v.toFixed(0) : v; };
        if ($$.__axis_x_tick_format) {
            if (typeof $$.__axis_x_tick_format === 'function') {
                format = $$.__axis_x_tick_format;
            } else if ($$.isTimeSeries) {
                format = function (date) {
                    return date ? $$.axisTimeFormat($$.__axis_x_tick_format)(date) : "";
                };
            }
        }
        return function (v) { return format.call($$, v); };
    };
    c3.fn.$$.getAxisLabelOptionByAxisId = function (axisId) {
        var $$ = this, option;
        if (axisId === 'y') {
            option = $$.__axis_y_label;
        } else if (axisId === 'y2') {
            option = $$.__axis_y2_label;
        } else if (axisId === 'x') {
            option = $$.__axis_x_label;
        }
        return option;
    };
    c3.fn.$$.getAxisLabelText = function (axisId) {
        var option = this.getAxisLabelOptionByAxisId(axisId);
        return typeof option === 'string' ? option : option ? option.text : null;
    };
    c3.fn.$$.setAxisLabelText = function (axisId, text) {
        var option = this.getAxisLabelOptionByAxisId(axisId);
        if (typeof option === 'string') {
            if (axisId === 'y') {
                $$.__axis_y_label = text;
            } else if (axisId === 'y2') {
                $$.__axis_y2_label = text;
            } else if (axisId === 'x') {
                $$.__axis_x_label = text;
            }
        } else if (option) {
            option.text = text;
        }
    };
    c3.fn.$$.getAxisLabelPosition = function (axisId, defaultPosition) {
        var option = this.getAxisLabelOptionByAxisId(axisId),
            position = (option && typeof option === 'object' && option.position) ? option.position : defaultPosition;
        return {
            isInner: position.indexOf('inner') >= 0,
            isOuter: position.indexOf('outer') >= 0,
            isLeft: position.indexOf('left') >= 0,
            isCenter: position.indexOf('center') >= 0,
            isRight: position.indexOf('right') >= 0,
            isTop: position.indexOf('top') >= 0,
            isMiddle: position.indexOf('middle') >= 0,
            isBottom: position.indexOf('bottom') >= 0
        };
    };
    c3.fn.$$.getXAxisLabelPosition = function () {
        var $$ = this;
        return this.getAxisLabelPosition('x', $$.__axis_rotated ? 'inner-top' : 'inner-right');
    };
    c3.fn.$$.getYAxisLabelPosition = function () {
        var $$ = this;
        return this.getAxisLabelPosition('y', $$.__axis_rotated ? 'inner-right' : 'inner-top');
    };
    c3.fn.$$.getY2AxisLabelPosition = function () {
        var $$ = this;
        return this.getAxisLabelPosition('y2', $$.__axis_rotated ? 'inner-right' : 'inner-top');
    };
    c3.fn.$$.getAxisLabelPositionById = function (id) {
        var $$ = this;
        return id === 'y2' ? $$.getY2AxisLabelPosition() : id === 'y' ? $$.getYAxisLabelPosition() : $$.getXAxisLabelPosition();
    };
    c3.fn.$$.textForXAxisLabel = function () {
        return this.getAxisLabelText('x');
    };
    c3.fn.$$.textForYAxisLabel = function () {
        return this.getAxisLabelText('y');
    };
    c3.fn.$$.textForY2AxisLabel = function () {
        return this.getAxisLabelText('y2');
    };
    c3.fn.$$.xForAxisLabel = function (forHorizontal, position) {
        var $$ = this;
        if (forHorizontal) {
            return position.isLeft ? 0 : position.isCenter ? $$.width / 2 : $$.width;
        } else {
            return position.isBottom ? -$$.height : position.isMiddle ? -$$.height / 2 : 0;
        }
    };
    c3.fn.$$.dxForAxisLabel = function (forHorizontal, position) {
        if (forHorizontal) {
            return position.isLeft ? "0.5em" : position.isRight ? "-0.5em" : "0";
        } else {
            return position.isTop ? "-0.5em" : position.isBottom ? "0.5em" : "0";
        }
    };
    c3.fn.$$.textAnchorForAxisLabel = function (forHorizontal, position) {
        if (forHorizontal) {
            return position.isLeft ? 'start' : position.isCenter ? 'middle' : 'end';
        } else {
            return position.isBottom ? 'start' : position.isMiddle ? 'middle' : 'end';
        }
    };
    c3.fn.$$.xForXAxisLabel = function () {
        var $$ = this;
        return $$.xForAxisLabel(!$$.__axis_rotated, $$.getXAxisLabelPosition());
    };
    c3.fn.$$.xForYAxisLabel = function () {
        return this.xForAxisLabel(this.__axis_rotated, this.getYAxisLabelPosition());
    };
    c3.fn.$$.xForY2AxisLabel = function () {
        return this.xForAxisLabel(this.__axis_rotated, this.getY2AxisLabelPosition());
    };
    c3.fn.$$.dxForXAxisLabel = function () {
        return this.dxForAxisLabel(!this.__axis_rotated, this.getXAxisLabelPosition());
    };
    c3.fn.$$.dxForYAxisLabel = function () {
        return this.dxForAxisLabel(this.__axis_rotated, this.getYAxisLabelPosition());
    };
    c3.fn.$$.dxForY2AxisLabel = function () {
        return this.dxForAxisLabel(this.__axis_rotated, this.getY2AxisLabelPosition());
    };
    c3.fn.$$.dyForXAxisLabel = function () {
        var $$ = this, position = $$.getXAxisLabelPosition();
        if ($$.__axis_rotated) {
            return position.isInner ? "1.2em" : -25 - $$.getMaxTickWidth('x');
        } else {
            return position.isInner ? "-0.5em" : $$.__axis_x_height ? $$.__axis_x_height - 10 : "3em";
        }
    };
    c3.fn.$$.dyForYAxisLabel = function () {
        var $$ = this, position = $$.getYAxisLabelPosition();
        if ($$.__axis_rotated) {
            return position.isInner ? "-0.5em" : "3em";
        } else {
            return position.isInner ? "1.2em" : -20 - $$.getMaxTickWidth('y');
        }
    };
    c3.fn.$$.dyForY2AxisLabel = function () {
        var $$ = this, position = $$.getY2AxisLabelPosition();
        if ($$.__axis_rotated) {
            return position.isInner ? "1.2em" : "-2.2em";
        } else {
            return position.isInner ? "-0.5em" : 30 + this.getMaxTickWidth('y2');
        }
    };
    c3.fn.$$.textAnchorForXAxisLabel = function () {
        var $$ = this;
        return $$.textAnchorForAxisLabel(!$$.__axis_rotated, $$.getXAxisLabelPosition());
    };
    c3.fn.$$.textAnchorForYAxisLabel = function () {
        var $$ = this;
        return $$.textAnchorForAxisLabel($$.__axis_rotated, $$.getYAxisLabelPosition());
    };
    c3.fn.$$.textAnchorForY2AxisLabel = function () {
        var $$ = this;
        return $$.textAnchorForAxisLabel($$.__axis_rotated, $$.getY2AxisLabelPosition());
    };

    c3.fn.$$.xForRotatedTickText = function (r) {
        return 10 * Math.sin(Math.PI * (r / 180));
    };
    c3.fn.$$.yForRotatedTickText = function (r) {
        return 11.5 - 2.5 * (r / 15);
    };
    c3.fn.$$.rotateTickText = function (axis, transition, rotate) {
        axis.selectAll('.tick text')
            .style("text-anchor", "start");
        transition.selectAll('.tick text')
            .attr("y", this.yForRotatedTickText(rotate))
            .attr("x", this.xForRotatedTickText(rotate))
            .attr("transform", "rotate(" + rotate + ")");
    };

    c3.fn.$$.getMaxTickWidth = function (id) {
        var $$ = this;
        var maxWidth = 0, targetsToShow, scale, axis;
        if ($$.svg) {
            targetsToShow = this.filterTargetsToShow($$.data.targets);
            if (id === 'y') {
                scale = $$.y.copy().domain(this.getYDomain(targetsToShow, 'y'));
                axis = this.getYAxis(scale, $$.yOrient, $$.__axis_y_tick_format, $$.__axis_y_ticks);
            } else if (id === 'y2') {
                scale = $$.y2.copy().domain(this.getYDomain(targetsToShow, 'y2'));
                axis = this.getYAxis(scale, $$.y2Orient, $$.__axis_y2_tick_format, $$.__axis_y2_ticks);
            } else {
                scale = $$.x.copy().domain(this.getXDomain(targetsToShow));
                axis = this.getXAxis(scale, $$.xOrient, this.getXAxisTickFormat(), $$.__axis_x_tick_values ? $$.__axis_x_tick_values : $$.xAxis.tickValues());
            }
            $$.main.append("g").call(axis).each(function () {
                $$.d3.select(this).selectAll('text').each(function () {
                    var box = this.getBoundingClientRect();
                    if (maxWidth < box.width) { maxWidth = box.width; }
                });
            }).remove();
        }
        $$.currentMaxTickWidth = maxWidth <= 0 ? $$.currentMaxTickWidth : maxWidth;
        return $$.currentMaxTickWidth;
    };

    c3.fn.$$.updateAxisLabels = function (withTransition) {
        var $$ = this;
        var axisXLabel = $$.main.select('.' + this.CLASS.axisX + ' .' + this.CLASS.axisXLabel),
            axisYLabel = $$.main.select('.' + this.CLASS.axisY + ' .' + this.CLASS.axisYLabel),
            axisY2Label = $$.main.select('.' + this.CLASS.axisY2 + ' .' + this.CLASS.axisY2Label);
        (withTransition ? axisXLabel.transition() : axisXLabel)
            .attr("x", function () { return $$.xForXAxisLabel(); })
            .attr("dx", function () { return $$.dxForXAxisLabel(); })
            .attr("dy", function () { return $$.dyForXAxisLabel(); })
            .text(function () { return $$.textForXAxisLabel(); });
        (withTransition ? axisYLabel.transition() : axisYLabel)
            .attr("x", function () { return $$.xForYAxisLabel(); })
            .attr("dx", function () { return $$.dxForYAxisLabel(); })
            .attr("dy", function () { return $$.dyForYAxisLabel(); })
            .attr("dy", function () { return $$.dyForYAxisLabel(); })
            .text(function () { return $$.textForYAxisLabel(); });
        (withTransition ? axisY2Label.transition() : axisY2Label)
            .attr("x", function () { return $$.xForY2AxisLabel(); })
            .attr("dx", function () { return $$.dxForY2AxisLabel(); })
            .attr("dy", function () { return $$.dyForY2AxisLabel(); })
            .text(function () { return $$.textForY2AxisLabel(); });
    };

    c3.fn.$$.getAxisPadding = function (padding, key, defaultValue, all) {
        var ratio = padding.unit === 'ratio' ? all : 1;
        return this.isValue(padding[key]) ? padding[key] * ratio : defaultValue;
    };

    c3.fn.$$.generateTickValues = function (xs, tickCount) {
        var $$ = this;
        var tickValues = xs, targetCount, start, end, count, interval, i, tickValue;
        if (tickCount) {
            targetCount = typeof tickCount === 'function' ? tickCount() : tickCount;
            // compute ticks according to $$.__axis_x_tick_count
            if (targetCount === 1) {
                tickValues = [xs[0]];
            } else if (targetCount === 2) {
                tickValues = [xs[0], xs[xs.length - 1]];
            } else if (targetCount > 2) {
                count = targetCount - 2;
                start = xs[0];
                end = xs[xs.length - 1];
                interval = (end - start) / (count + 1);
                // re-construct uniqueXs
                tickValues = [start];
                for (i = 0; i < count; i++) {
                    tickValue = +start + interval * (i + 1);
                    tickValues.push($$.isTimeSeries ? new Date(tickValue) : tickValue);
                }
                tickValues.push(end);
            }
        }
        if (!$$.isTimeSeries) { tickValues = tickValues.sort(function (a, b) { return a - b; }); }
        return tickValues;
    };


    /**
     *  c3.region.js
     */
    c3.fn.$$.regionX = function (d) {
        var xPos, yScale = d.axis === 'y' ? y : y2;
        if (d.axis === 'y' || d.axis === 'y2') {
            xPos = $$.__axis_rotated ? ('start' in d ? yScale(d.start) : 0) : 0;
        } else {
            xPos = $$.__axis_rotated ? 0 : ('start' in d ? $$.x($$.isTimeSeries ? this.parseDate(d.start) : d.start) : 0);
        }
        return xPos;
    };
    c3.fn.$$.regionY = function (d) {
        var yPos, yScale = d.axis === 'y' ? y : y2;
        if (d.axis === 'y' || d.axis === 'y2') {
            yPos = $$.__axis_rotated ? 0 : ('end' in d ? yScale(d.end) : 0);
        } else {
            yPos = $$.__axis_rotated ? ('start' in d ? $$.x($$.isTimeSeries ? this.parseDate(d.start) : d.start) : 0) : 0;
        }
        return yPos;
    };
    c3.fn.$$.regionWidth = function (d) {
        var start = this.regionX(d), end, yScale = d.axis === 'y' ? y : y2;
        if (d.axis === 'y' || d.axis === 'y2') {
            end = $$.__axis_rotated ? ('end' in d ? yScale(d.end) : $$.width) : $$.width;
        } else {
            end = $$.__axis_rotated ? $$.width : ('end' in d ? $$.x($$.isTimeSeries ? this.parseDate(d.end) : d.end) : $$.width);
        }
        return end < start ? 0 : end - start;
    };
    c3.fn.$$.regionHeight = function (d) {
        var start = this.regionY(d), end, yScale = d.axis === 'y' ? y : y2;
        if (d.axis === 'y' || d.axis === 'y2') {
            end = $$.__axis_rotated ? $$.height : ('start' in d ? yScale(d.start) : $$.height);
        } else {
            end = $$.__axis_rotated ? ('end' in d ? $$.x($$.isTimeSeries ? this.parseDate(d.end) : d.end) : $$.height) : $$.height;
        }
        return end < start ? 0 : end - start;
    };
    c3.fn.$$.isRegionOnX = function (d) {
        return !d.axis || d.axis === 'x';
    };




    /**
     *  c3.arc.js
     */
    c3.fn.$$.updateAngle = function (d) {
        var $$ = this, found = false, index = 0;
        $$.pie($$.filterTargetsToShow($$.data.targets)).sort(this.descByStartAngle).forEach(function (t) {
            if (! found && t.data.id === d.data.id) {
                found = true;
                d = t;
                d.index = index;
            }
            index++;
        });
        if (isNaN(d.endAngle)) {
            d.endAngle = d.startAngle;
        }
        if (this.isGaugeType(d.data)) {
            var gMin = $$.__gauge_min, gMax = $$.__gauge_max,
                gF = Math.abs(gMin) + gMax,
                aTic = (Math.PI) / gF;
            d.startAngle = (-1 * (Math.PI / 2)) + (aTic * Math.abs(gMin));
            d.endAngle = d.startAngle + (aTic * ((d.value > gMax) ? gMax : d.value));
        }
        return found ? d : null;
    };
    c3.fn.$$.getSvgArc = function () {
        var $$ = this;
        var arc = $$.d3.svg.arc().outerRadius($$.radius).innerRadius($$.innerRadius),
            newArc = function (d, withoutUpdate) {
                var updated;
                if (withoutUpdate) { return arc(d); } // for interpolate
                updated = $$.updateAngle(d);
                return updated ? arc(updated) : "M 0 0";
            };
        // TODO: extends all function
        newArc.centroid = arc.centroid;
        return newArc;
    };
    c3.fn.$$.getSvgArcExpanded = function (rate) {
        var $$ = this;
        var arc = $$.d3.svg.arc().outerRadius($$.radiusExpanded * (rate ? rate : 1)).innerRadius($$.innerRadius);
        return function (d) {
            var updated = $$.updateAngle(d);
            return updated ? arc(updated) : "M 0 0";
        };
    };
    c3.fn.$$.getArc = function (d, withoutUpdate, force) {
        return force || this.isArcType(d.data) ? this.svgArc(d, withoutUpdate) : "M 0 0";
    };
    c3.fn.$$.transformForArcLabel = function (d) {
        var $$ = this, updated = $$.updateAngle(d), c, x, y, h, ratio, translate = "";
        if (updated && !this.hasGaugeType($$.data.targets)) {
            c = this.svgArc.centroid(updated);
            x = isNaN(c[0]) ? 0 : c[0];
            y = isNaN(c[1]) ? 0 : c[1];
            h = Math.sqrt(x * x + y * y);
            // TODO: ratio should be an option?
            ratio = $$.radius && h ? (36 / $$.radius > 0.375 ? 1.175 - 36 / $$.radius : 0.8) * $$.radius / h : 0;
            translate = "translate(" + (x * ratio) +  ',' + (y * ratio) +  ")";
        }
        return translate;
    };
    c3.fn.$$.getArcRatio = function (d) {
        var $$ = this, whole = this.hasGaugeType($$.data.targets) ? Math.PI : (Math.PI * 2);
        return d ? (d.endAngle - d.startAngle) / whole : null;
    };
    c3.fn.$$.convertToArcData = function (d) {
        return this.addName({
            id: d.data.id,
            value: d.value,
            ratio: this.getArcRatio(d),
            index: d.index
        });
    };
    c3.fn.$$.textForArcLabel = function (d) {
        var $$ = this, updated, value, ratio, format;
        if (! $$.shouldShowArcLabel()) { return ""; }
        updated = $$.updateAngle(d);
        value = updated ? updated.value : null;
        ratio = $$.getArcRatio(updated);
        if (! $$.hasGaugeType($$.data.targets) && ! $$.meetsArcLabelThreshold(ratio)) { return ""; }
        format = $$.getArcLabelFormat();
        return format ? format(value, ratio) : $$.defaultArcValueFormat(value, ratio);
    };
    c3.fn.$$.expandArc = function (id, withoutFadeOut) {
        var $$ = this, CLASS= $$.CLASS,
            target = $$.svg.selectAll('.' + CLASS.chartArc + $$.selectorTarget(id)),
            noneTargets = $$.svg.selectAll('.' + CLASS.arc).filter(function (data) { return data.data.id !== id; });

        if ($$.shouldExpand(id)) {
            target.selectAll('path')
              .transition().duration(50)
                .attr("d", $$.svgArcExpanded)
              .transition().duration(100)
                .attr("d", $$.svgArcExpandedSub)
                .each(function (d) {
                    if ($$.isDonutType(d.data)) {
                        // callback here
                    }
                });
        }
        if (!withoutFadeOut) {
            noneTargets.style("opacity", 0.3);
        }
    };
    c3.fn.$$.unexpandArc = function (id) {
        var $$ = this, CLASS = $$.CLASS,
            target = $$.svg.selectAll('.' + CLASS.chartArc + $$.selectorTarget(id));
        target.selectAll('path.' + CLASS.arc)
          .transition().duration(50)
            .attr("d", $$.svgArc);
        $$.svg.selectAll('.' + CLASS.arc)
            .style("opacity", 1);
    };
    c3.fn.$$.shouldExpand = function (id) {
        var $$ = this;
        return ($$.isDonutType(id) && $$.__donut_expand) || ($$.isGaugeType(id) && $$.__gauge_expand) || ($$.isPieType(id) && $$.__pie_expand);
    };
    c3.fn.$$.shouldShowArcLabel = function () {
        var $$ = this, shouldShow = true;
        if (this.hasDonutType($$.data.targets)) {
            shouldShow = $$.__donut_label_show;
        } else if (this.hasPieType($$.data.targets)) {
            shouldShow = $$.__pie_label_show;
        }
        // when gauge, always true
        return shouldShow;
    };
    c3.fn.$$.meetsArcLabelThreshold = function (ratio) {
        var $$ = this, threshold = this.hasDonutType($$.data.targets) ? $$.__donut_label_threshold : $$.__pie_label_threshold;
        return ratio >= threshold;
    };
    c3.fn.$$.getArcLabelFormat = function () {
        var $$ = this, format = $$.__pie_label_format;
        if (this.hasGaugeType($$.data.targets)) {
            format = $$.__gauge_label_format;
        } else if (this.hasDonutType($$.data.targets)) {
            format = $$.__donut_label_format;
        }
        return format;
    };
    c3.fn.$$.getArcTitle = function () {
        var $$ = this;
        return $$.hasDonutType($$.data.targets) ? $$.__donut_title : "";
    };
    c3.fn.$$.descByStartAngle = function (a, b) {
        return a.startAngle - b.startAngle;
    };



    /**
     *  c3.cache.js
     */
    c3.fn.$$.hasCaches = function (ids) {
        for (var i = 0; i < ids.length; i++) {
            if (! (ids[i] in $$.cache)) { return false; }
        }
        return true;
    };
    c3.fn.$$.addCache = function (id, target) {
        var $$ = this;
        $$.cache[id] = $$.cloneTarget(target);
    };
    c3.fn.$$.getCaches = function (ids) {
        var targets = [], i;
        for (i = 0; i < ids.length; i++) {
            if (ids[i] in $$.cache) { targets.push(this.cloneTarget($$.cache[ids[i]])); }
        }
        return targets;
    };


    /**
     *  c3.zoom.js
     */
    c3.fn.$$.updateZoom = function () {
        var $$ = this, z = $$.__zoom_enabled ? $$.zoom : function () {};
        $$.main.select('.' + this.CLASS.zoomRect).call(z);
        $$.main.selectAll('.' + this.CLASS.eventRect).call(z);
    };




    /**
     *  c3.util.js
     */
    c3.fn.$$.isValue = function (v) {
        return v || v === 0;
    };
    c3.fn.$$.isUndefined = function (v) {
        return typeof v === 'undefined';
    };
    c3.fn.$$.isDefined = function (v) {
        return typeof v !== 'undefined';
    };
    c3.fn.$$.ceil10 = function (v) {
        return Math.ceil(v / 10) * 10;
    };
    c3.fn.$$.asHalfPixel = function (n) {
        return Math.ceil(n) + 0.5;
    };
    c3.fn.$$.diffDomain = function (d) {
        return d[1] - d[0];
    };
    c3.fn.$$.isEmpty = function (o) {
        return !o || (typeof o === 'string' && o.length === 0) || (typeof o === 'object' && Object.keys(o).length === 0);
    };
    c3.fn.$$.notEmpty = function (o) {
        return Object.keys(o).length > 0;
    };
    c3.fn.$$.getOption = function (options, key, defaultValue) {
        return typeof options[key] !== 'undefined' ? options[key] : defaultValue;
    };
    c3.fn.$$.hasValue = function (dict, value) {
        var found = false;
        Object.keys(dict).forEach(function (key) {
            if (dict[key] === value) { found = true; }
        });
        return found;
    };
    c3.fn.$$.getPathBox = function (path) {
        var box = path.getBoundingClientRect(),
            items = [path.pathSegList.getItem(0), path.pathSegList.getItem(1)],
            minX = items[0].x, minY = Math.min(items[0].y, items[1].y);
        return {x: minX, y: minY, width: box.width, height: box.height};
    };
    c3.fn.$$.getTextRect = function (text, cls) {
        var $$ = this, rect;
        $$.d3.select('body').selectAll('.dummy')
            .data([text])
          .enter().append('text')
            .classed(cls ? cls : "", true)
            .text(text)
          .each(function () { rect = this.getBoundingClientRect(); })
            .remove();
        return rect;
    };

    c3.fn.$$.getEmptySelection = function () {
        var $$ = this;
        return $$.d3.selectAll([]);
    };


    /**
     *  c3.selection.js
     */
    c3.fn.$$.selectPoint = function (target, d, i) {
        var $$ = this;
        $$.__data_onselected.call(c3, d, target.node());
        // add selected-circle on low layer g
        main.select('.' + this.CLASS.selectedCircles + $$.getTargetSelectorSuffix(d.id)).selectAll('.' + this.CLASS.selectedCircle + '-' + i)
            .data([d])
          .enter().append('circle')
            .attr("class", function () { return generateClass(this.CLASS.selectedCircle, i); })
            .attr("cx", $$.__axis_rotated ? circleY : circleX)
            .attr("cy", $$.__axis_rotated ? circleX : circleY)
            .attr("stroke", function () { return color(d); })
            .attr("r", pointSelectR(d) * 1.4)
          .transition().duration(100)
            .attr("r", pointSelectR);
    };
    c3.fn.$$.unselectPoint = function (target, d, i) {
        var $$ = this;
        $$.__data_onunselected.call(c3, d, target.node());
        // remove selected-circle from low layer g
        main.select('.' + $$.CLASS.selectedCircles + $$.getTargetSelectorSuffix(d.id)).selectAll('.' + this.CLASS.selectedCircle + '-' + i)
          .transition().duration(100).attr('r', 0)
            .remove();
    };
    c3.fn.$$.togglePoint = function (selected, target, d, i) {
        selected ? selectPoint(target, d, i) : unselectPoint(target, d, i);
    };
    c3.fn.$$.selectBar = function (target, d) {
        $$.__data_onselected.call(c3, d, target.node());
        target.transition().duration(100).style("fill", function () { return $$.d3.rgb($$.color(d)).brighter(0.75); });
    };
    c3.fn.$$.unselectBar = function (target, d) {
        $$.__data_onunselected.call(c3, d, target.node());
        target.transition().duration(100).style("fill", function () { return $$.color(d); });
    };
    c3.fn.$$.toggleBar = function (selected, target, d, i) {
        selected ? this.selectBar(target, d, i) : this.unselectBar(target, d, i);
    };
    c3.fn.$$.toggleArc = function (selected, target, d, i) {
        this.toggleBar(selected, target, d.data, i);
    };
    c3.fn.$$.getToggle = function (that) {
        // path selection not supported yet
        return that.nodeName === 'circle' ? this.togglePoint : ($$.d3.select(that).classed(this.CLASS.bar) ? this.toggleBar : this.toggleArc);
    };
    c3.fn.$$.toggleShape = function (that, d, i) {
        var $$ = this, CLASS = $$.CLASS, d3 = $$.d3,
            shape = d3.select(that), isSelected = shape.classed(CLASS.SELECTED), isWithin, toggle;
        if (that.nodeName === 'circle') {
            isWithin = $$.isWithinCircle(that, $$.pointSelectR(d) * 1.5);
            toggle = $$.togglePoint;
        }
        else if (that.nodeName === 'path') {
            if (shape.classed(CLASS.bar)) {
                isWithin = $$.isWithinBar(that);
                toggle = $$.toggleBar;
            } else { // would be arc
                isWithin = true;
                toggle = $$.toggleArc;
            }
        }
        if ($$.__data_selection_grouped || isWithin) {
            if ($$.__data_selection_enabled && $$.__data_selection_isselectable(d)) {
                if (!$$.__data_selection_multiple) {
                    $$.main.selectAll('.' + CLASS.shapes + ($$.__data_selection_grouped ? $$.getTargetSelectorSuffix(d.id) : "")).selectAll('.' + CLASS.shape).each(function (d, i) {
                        var shape = d3.select(this);
                        if (shape.classed(CLASS.SELECTED)) { toggle(false, shape.classed(CLASS.SELECTED, false), d, i); }
                    });
                }
                shape.classed(CLASS.SELECTED, !isSelected);
                toggle(!isSelected, shape, d, i);
            }
            $$.__data_onclick.call(c3, d, that);
        }
    };


    /**
     *  c3.transition.js
     */
    c3.fn.$$.generateAxisTransitions = function (duration) {
        var $$ = this, axes = $$.axes;
        return {
            axisX: duration ? axes.x.transition().duration(duration) : axes.x,
            axisY: duration ? axes.y.transition().duration(duration) : axes.y,
            axisY2: duration ? axes.y2.transition().duration(duration) : axes.y2,
            axisSubX: duration ? axes.subx.transition().duration(duration) : axes.subx
        };
    };
    c3.fn.$$.endall = function (transition, callback) {
        var n = 0;
        transition
            .each(function () { ++n; })
            .each("end", function () {
                if (!--n) { callback.apply(this, arguments); }
            });
    };
    c3.fn.$$.generateWait = function () {
        var transitionsToWait = [],
            f = function (transition, callback) {
                var timer = setInterval(function () {
                    var done = 0;
                    transitionsToWait.forEach(function (t) {
                        if (t.empty()) {
                            done += 1;
                            return;
                        }
                        try {
                            t.transition();
                        } catch (e) {
                            done += 1;
                        }
                    });
                    if (done === transitionsToWait.length) {
                        clearInterval(timer);
                        if (callback) { callback(); }
                    }
                }, 10);
            };
        f.add = function (transition) {
            transitionsToWait.push(transition);
        };
        return f;
    };


    /**
     *  c3.transform.js
     */
    c3.fn.$$.transformTo = function (targetIds, type, optionsForRedraw) {
        var $$ = this,
            withTransitionForAxis = !$$.hasArcType($$.data.targets),
            options = optionsForRedraw || {withTransitionForAxis: withTransitionForAxis};
        options.withTransitionForTransform = false;
        $$.transiting = false;
        $$.setTargetType(targetIds, type);
        $$.updateAndRedraw(options);
    };


    /**
     * c3.class.js
     */
    c3.fn.$$.CLASS = {
        target: 'c3-target',
        chart : 'c3-chart',
        chartLine: 'c3-chart-line',
        chartLines: 'c3-chart-lines',
        chartBar: 'c3-chart-bar',
        chartBars: 'c3-chart-bars',
        chartText: 'c3-chart-text',
        chartTexts: 'c3-chart-texts',
        chartArc: 'c3-chart-arc',
        chartArcs: 'c3-chart-arcs',
        chartArcsTitle: 'c3-chart-arcs-title',
        chartArcsBackground: 'c3-chart-arcs-background',
        chartArcsGaugeUnit: 'c3-chart-arcs-gauge-unit',
        chartArcsGaugeMax: 'c3-chart-arcs-gauge-max',
        chartArcsGaugeMin: 'c3-chart-arcs-gauge-min',
        selectedCircle: 'c3-selected-circle',
        selectedCircles: 'c3-selected-circles',
        eventRect: 'c3-event-rect',
        eventRects: 'c3-event-rects',
        eventRectsSingle: 'c3-event-rects-single',
        eventRectsMultiple: 'c3-event-rects-multiple',
        zoomRect: 'c3-zoom-rect',
        brush: 'c3-brush',
        focused: 'c3-focused',
        region: 'c3-region',
        regions: 'c3-regions',
        tooltip: 'c3-tooltip',
        tooltipName: 'c3-tooltip-name',
        shape: 'c3-shape',
        shapes: 'c3-shapes',
        line: 'c3-line',
        lines: 'c3-lines',
        bar: 'c3-bar',
        bars: 'c3-bars',
        circle: 'c3-circle',
        circles: 'c3-circles',
        arc: 'c3-arc',
        arcs: 'c3-arcs',
        area: 'c3-area',
        areas: 'c3-areas',
        empty: 'c3-empty',
        text: 'c3-text',
        texts: 'c3-texts',
        gaugeValue: 'c3-gauge-value',
        grid: 'c3-grid',
        xgrid: 'c3-xgrid',
        xgrids: 'c3-xgrids',
        xgridLine: 'c3-xgrid-line',
        xgridLines: 'c3-xgrid-lines',
        xgridFocus: 'c3-xgrid-focus',
        ygrid: 'c3-ygrid',
        ygrids: 'c3-ygrids',
        ygridLine: 'c3-ygrid-line',
        ygridLines: 'c3-ygrid-lines',
        axis: 'c3-axis',
        axisX: 'c3-axis-x',
        axisXLabel: 'c3-axis-x-label',
        axisY: 'c3-axis-y',
        axisYLabel: 'c3-axis-y-label',
        axisY2: 'c3-axis-y2',
        axisY2Label: 'c3-axis-y2-label',
        legendBackground: 'c3-legend-background',
        legendItem: 'c3-legend-item',
        legendItemEvent: 'c3-legend-item-event',
        legendItemTile: 'c3-legend-item-tile',
        legendItemHidden: 'c3-legend-item-hidden',
        legendItemFocused: 'c3-legend-item-focused',
        dragarea: 'c3-dragarea',
        EXPANDED: '_expanded_',
        SELECTED: '_selected_',
        INCLUDED: '_included_'
    };
    c3.fn.$$.generateClass = function (prefix, targetId) {
        var $$ = this;
        return " " + prefix + " " + prefix + $$.getTargetSelectorSuffix(targetId);
    };
    c3.fn.$$.classText = function (d) {
        return this.generateClass(this.CLASS.text, d.index);
    };
    c3.fn.$$.classTexts = function (d) {
        return this.generateClass(this.CLASS.texts, d.id);
    };
    c3.fn.$$.classShape = function (d) {
        return this.generateClass(this.CLASS.shape, d.index);
    };
    c3.fn.$$.classShapes = function (d) {
        return this.generateClass(this.CLASS.shapes, d.id);
    };
    c3.fn.$$.classLine = function (d) {
        return this.classShape(d) + this.generateClass(this.CLASS.line, d.id);
    };
    c3.fn.$$.classLines = function (d) {
        return this.classShapes(d) + this.generateClass(this.CLASS.lines, d.id);
    };
    c3.fn.$$.classCircle = function (d) {
        return this.classShape(d) + this.generateClass(this.CLASS.circle, d.index);
    };
    c3.fn.$$.classCircles = function (d) {
        return this.classShapes(d) + this.generateClass(this.CLASS.circles, d.id);
    };
    c3.fn.$$.classBar = function (d) {
        return this.classShape(d) + this.generateClass(this.CLASS.bar, d.index);
    };
    c3.fn.$$.classBars = function (d) {
        return this.classShapes(d) + this.generateClass(this.CLASS.bars, d.id);
    };
    c3.fn.$$.classArc = function (d) {
        return this.classShape(d.data) + this.generateClass(this.CLASS.arc, d.data.id);
    };
    c3.fn.$$.classArcs = function (d) {
        return this.classShapes(d.data) + this.generateClass(this.CLASS.arcs, d.data.id);
    };
    c3.fn.$$.classArea = function (d) {
        return this.classShape(d) + this.generateClass(this.CLASS.area, d.id);
    };
    c3.fn.$$.classAreas = function (d) {
        return this.classShapes(d) + this.generateClass(this.CLASS.areas, d.id);
    };
    c3.fn.$$.classRegion = function (d, i) {
        return this.generateClass(this.CLASS.region, i) + ' ' + ('class' in d ? d.class : '');
    };
    c3.fn.$$.classEvent = function (d) {
        return this.generateClass(this.CLASS.eventRect, d.index);
    };
    c3.fn.$$.classTarget = function (id) {
        var $$ = this;
        var additionalClassSuffix = $$.__data_classes[id], additionalClass = '';
        if (additionalClassSuffix) {
            additionalClass = ' ' + $$.CLASS.target + '-' + additionalClassSuffix;
        }
        return $$.generateClass($$.CLASS.target, id) + additionalClass;
    };
    c3.fn.$$.classChartText = function (d) {
        return this.CLASS.chartText + this.classTarget(d.id);
    };
    c3.fn.$$.classChartLine = function (d) {
        return this.CLASS.chartLine + this.classTarget(d.id);
    };
    c3.fn.$$.classChartBar = function (d) {
        return this.CLASS.chartBar + this.classTarget(d.id);
    };
    c3.fn.$$.classChartArc = function (d) {
        return this.CLASS.chartArc + this.classTarget(d.data.id);
    };
    c3.fn.$$.getTargetSelectorSuffix = function (targetId) {
        return targetId || targetId === 0 ? '-' + (targetId.replace ? targetId.replace(/([^a-zA-Z0-9-_])/g, '-') : targetId) : '';
    };
    c3.fn.$$.selectorTarget = function (id) {
        var $$ = this;
        return '.' + $$.CLASS.target + $$.getTargetSelectorSuffix(id);
    };
    c3.fn.$$.selectorTargets = function (ids) {
        var $$ = this;
        return ids.length ? ids.map(function (id) { return $$.selectorTarget(id); }) : null;
    };
    c3.fn.$$.selectorLegend = function (id) {
        var $$ = this;
        return '.' + $$.CLASS.legendItem + $$.getTargetSelectorSuffix(id);
    };
    c3.fn.$$.selectorLegends = function (ids) {
        var $$ = this;
        return ids.length ? ids.map(function (id) { return $$.selectorLegend(id); }) : null;
    };



    /**
     *  c3.format.js
     */
    c3.fn.$$.getYFormat = function (forArc) {
        var $$ = this,
            formatForY = forArc && !$$.hasGaugeType($$.data.targets) ? $$.defaultArcValueFormat : $$.yFormat,
            formatForY2 = forArc && !$$.hasGaugeType($$.data.targets) ? $$.defaultArcValueFormat : $$.y2Format;
        return function (v, ratio, id) {
            var format = $$.getAxisId(id) === 'y2' ? formatForY2 : formatForY;
            return format.call($$, v, ratio);
        };
    };
    c3.fn.$$.yFormat = function (v) {
        var $$ = this, format = $$.__axis_y_tick_format ? $$.__axis_y_tick_format : $$.defaultValueFormat;
        return format.call($$, v);
    };
    c3.fn.$$.y2Format = function (v) {
        var $$ = this, format = $$.__axis_y2_tick_format ? $$.__axis_y2_tick_format : $$.defaultValueFormat;
        return format.call($$, v);
    };
    c3.fn.$$.defaultValueFormat = function (v) {
        return this.isValue(v) ? +v : "";
    };
    c3.fn.$$.defaultArcValueFormat = function (v, ratio) {
        return (ratio * 100).toFixed(1) + '%';
    };
    c3.fn.$$.formatByAxisId = function (axisId) {
        var $$ = this.$$, format = function (v) { return this.isValue(v) ? +v : ""; };
        // find format according to axis id
        if (typeof $$.__data_labels.format === 'function') {
            format = $$.__data_labels.format;
        } else if (typeof $$.__data_labels.format === 'object') {
            if (typeof $$.__data_labels.format[axisId] === 'function') {
                format = $$.__data_labels.format[axisId];
            }
        }
        return format;
    };



    /**
     *  c3.drag.js
     */
    c3.fn.$$.drag = function (mouse) {
        var $$ = this, main = $$.main, CLASS = $$.CLASS, d3 = $$.d3;
        var sx, sy, mx, my, minX, maxX, minY, maxY;

        if ($$.hasArcType($$.data.targets)) { return; }
        if (! $$.__data_selection_enabled) { return; } // do nothing if not selectable
        if ($$.__zoom_enabled && ! $$.zoom.altDomain) { return; } // skip if zoomable because of conflict drag dehavior
        if (!$$.__data_selection_multiple) { return; } // skip when single selection because drag is used for multiple selection

        sx = $$.dragStart[0];
        sy = $$.dragStart[1];
        mx = mouse[0];
        my = mouse[1];
        minX = Math.min(sx, mx);
        maxX = Math.max(sx, mx);
        minY = ($$.__data_selection_grouped) ? $$.margin.top : Math.min(sy, my);
        maxY = ($$.__data_selection_grouped) ? $$.height : Math.max(sy, my);

        main.select('.' + CLASS.dragarea)
            .attr('x', minX)
            .attr('y', minY)
            .attr('width', maxX - minX)
            .attr('height', maxY - minY);
        // TODO: binary search when multiple xs
        main.selectAll('.' + CLASS.shapes).selectAll('.' + CLASS.shape)
            .filter(function (d) { return $$.__data_selection_isselectable(d); })
            .each(function (d, i) {
                var shape = d3.select(this),
                    isSelected = shape.classed(CLASS.SELECTED),
                    isIncluded = shape.classed(CLASS.INCLUDED),
                    _x, _y, _w, _h, toggle, isWithin = false, box;
                if (shape.classed(CLASS.circle)) {
                    _x = shape.attr("cx") * 1;
                    _y = shape.attr("cy") * 1;
                    toggle = $$.togglePoint;
                    isWithin = minX < _x && _x < maxX && minY < _y && _y < maxY;
                }
                else if (shape.classed(CLASS.bar)) {
                    box = $$.getPathBox(this);
                    _x = box.x;
                    _y = box.y;
                    _w = box.width;
                    _h = box.height;
                    toggle = $$.toggleBar;
                    isWithin = !(maxX < _x || _x + _w < minX) && !(maxY < _y || _y + _h < minY);
                } else {
                    // line/area selection not supported yet
                    return;
                }
                if (isWithin ^ isIncluded) {
                    shape.classed(CLASS.INCLUDED, !isIncluded);
                    // TODO: included/unincluded callback here
                    shape.classed(CLASS.SELECTED, !isSelected);
                    toggle.call($$, !isSelected, shape, d, i);
                }
            });
    };

    c3.fn.$$.dragstart = function (mouse) {
        var $$ = this;
        if ($$.hasArcType($$.data.targets)) { return; }
        if (! $$.__data_selection_enabled) { return; } // do nothing if not selectable
        $$.dragStart = mouse;
        $$.main.select('.' + $$.CLASS.chart).append('rect')
            .attr('class', $$.CLASS.dragarea)
            .style('opacity', 0.1);
        $$.dragging = true;
        $$.__data_ondragstart.call(c3);
    };

    c3.fn.$$.dragend = function () {
        var $$ = this;
        if ($$.hasArcType($$.data.targets)) { return; }
        if (! $$.__data_selection_enabled) { return; } // do nothing if not selectable
        $$.main.select('.' + $$.CLASS.dragarea)
            .transition().duration(100)
            .style('opacity', 0)
            .remove();
        $$.main.selectAll('.' + $$.CLASS.shape)
            .classed($$.CLASS.INCLUDED, false);
        $$.dragging = false;
        $$.__data_ondragend.call(c3);
    };





    /**
     *  c3.api.js (or c3.api.focus.js, etc?)
     */
    c3.fn.chart.focus = function (targetId) {
        var $$ = this.$$,
            candidates = $$.svg.selectAll($$.selectorTarget(targetId)),
            candidatesForNoneArc = candidates.filter(function (d) { return $$.isNoneArc(d); }),
            candidatesForArc = candidates.filter(function (d) { return $$.isArc(d); });
        function focus(targets) {
            $$.filterTargetsToShow(targets).transition().duration(100).style('opacity', 1);
        }
        this.revert();
        this.defocus();
        focus(candidatesForNoneArc.classed($$.CLASS.focused, true));
        focus(candidatesForArc);
        if ($$.hasArcType($$.data.targets)) {
            $$.expandArc(targetId, true);
        }
        $$.toggleFocusLegend(targetId, true);
    };

    c3.fn.chart.defocus = function (targetId) {
        var $$ = this.$$,
            candidates = $$.svg.selectAll($$.selectorTarget(targetId)),
            candidatesForNoneArc = candidates.filter(function (d) { return $$.isNoneArc(d); }),
            candidatesForArc = candidates.filter(function (d) { return $$.isArc(d); });
        function defocus(targets) {
            $$.filterTargetsToShow(targets).transition().duration(100).style('opacity', 0.3);
        }
        this.revert();
        defocus(candidatesForNoneArc.classed($$.CLASS.focused, false));
        defocus(candidatesForArc);
        if ($$.hasArcType($$.data.targets)) {
            $$.unexpandArc(targetId);
        }
        $$.toggleFocusLegend(targetId, false);
    };

    c3.fn.chart.revert = function (targetId) {
        var $$ = this.$$,
            candidates = $$.svg.selectAll($$.selectorTarget(targetId)),
            candidatesForNoneArc = candidates.filter(function (d) { return $$.isNoneArc(d); }),
            candidatesForArc = candidates.filter(function (d) { return $$.isArc(d); });
        function revert(targets) {
            $$.filterTargetsToShow(targets).transition().duration(100).style('opacity', 1);
        }
        revert(candidatesForNoneArc.classed($$.CLASS.focused, false));
        revert(candidatesForArc);
        if ($$.hasArcType($$.data.targets)) {
            $$.unexpandArc(targetId);
        }
        $$.revertLegend();
    };

    c3.fn.chart.show = function (targetIds, options) {
        var $$ = this.$$;

        targetIds = $$.mapToTargetIds(targetIds);
        options = options || {};

        $$.removeHiddenTargetIds(targetIds);
        $$.svg.selectAll($$.selectorTargets(targetIds))
          .transition()
            .style('opacity', 1);

        if (options.withLegend) {
            $$.showLegend(targetIds);
        }

        $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true, withLegend: true});
    };

    c3.fn.chart.hide = function (targetIds, options) {
        var $$ = this.$$;

        targetIds = $$.mapToTargetIds(targetIds);
        options = options || {};

        $$.addHiddenTargetIds(targetIds);
        $$.svg.selectAll($$.selectorTargets(targetIds))
          .transition()
            .style('opacity', 0);

        if (options.withLegend) {
            $$.hideLegend(targetIds);
        }

        $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true, withLegend: true});
    };

    c3.fn.chart.toggle = function (targetId) {
        var $$ = this.$$;
        $$.isTargetToShow(targetId) ? this.hide(targetId) : this.show(targetId);
    };

    c3.fn.chart.zoom = function () {
    };
    c3.fn.chart.zoom.enable = function (enabled) {
        var $$ = this.$$;
        $$.__zoom_enabled = enabled;
        $$.updateAndRedraw();
    };
    c3.fn.chart.unzoom = function () {
        var $$ = this.$$;
        $$.brush.clear().update();
        $$.redraw({withUpdateXDomain: true});
    };

    c3.fn.chart.load = function (args) {
        var $$ = this.$$;
        // update xs if specified
        if (args.xs) {
            $$.addXs(args.xs);
        }
        // update classes if exists
        if ('classes' in args) {
            Object.keys(args.classes).forEach(function (id) {
                $$.__data_classes[id] = args.classes[id];
            });
        }
        // update categories if exists
        if ('categories' in args && $$.isCategorized) {
            $$.__axis_x_categories = args.categories;
        }
        // use cache if exists
        if ('cacheIds' in args && $$.hasCaches(args.cacheIds)) {
            $$.load($$.getCaches(args.cacheIds), args.done);
            return;
        }
        // unload if needed
        if ('unload' in args) {
            // TODO: do not unload if target will load (included in url/rows/columns)
            $$.unload($$.mapToTargetIds((typeof args.unload === 'boolean' && args.unload) ? null : args.unload), function () {
                $$.loadFromArgs(args);
            });
        } else {
            $$.loadFromArgs(args);
        }
    };

    c3.fn.chart.unload = function (args) {
        var $$ = this.$$;
        args = args || {};
        $$.unload($$.mapToTargetIds(args.ids), function () {
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true, withLegend: true});
            if (typeof args.done === 'function') { args.done(); }
        });
    };

    c3.fn.chart.flow = function (args) {
        var $$ = this.$$,
            targets = $$.convertDataToTargets($$.convertColumnsToData(args.columns), true),
            notfoundIds = [], orgDataCount = $$.getMaxDataCount(),
            dataCount, domain, baseTarget, baseValue, length = 0, tail = 0, diff, to;

        // Update/Add data
        $$.data.targets.forEach(function (t) {
            var found = false, i, j;
            for (i = 0; i < targets.length; i++) {
                if (t.id === targets[i].id) {
                    found = true;

                    if (t.values[t.values.length - 1]) {
                        tail = t.values[t.values.length - 1].index + 1;
                    }
                    length = targets[i].values.length;

                    for (j = 0; j < length; j++) {
                        targets[i].values[j].index = tail + j;
                        if (!$$.isTimeSeries) {
                            targets[i].values[j].x = tail + j;
                        }
                    }
                    t.values = t.values.concat(targets[i].values);

                    targets.splice(i, 1);
                    break;
                }
            }
            if (!found) { notfoundIds.push(t.id); }
        });

        // Append null for not found targets
        $$.data.targets.forEach(function (t) {
            var i, j;
            for (i = 0; i < notfoundIds.length; i++) {
                if (t.id === notfoundIds[i]) {
                    tail = t.values[t.values.length - 1].index + 1;
                    for (j = 0; j < length; j++) {
                        t.values.push({
                            id: t.id,
                            index: tail + j,
                            x: $$.isTimeSeries ? $$.getOtherTargetX(tail + j) : tail + j,
                            value: null
                        });
                    }
                }
            }
        });

        // Generate null values for new target
        if ($$.data.targets.length) {
            targets.forEach(function (t) {
                var i, missing = [];
                for (i = $$.data.targets[0].values[0].index; i < tail; i++) {
                    missing.push({
                        id: t.id,
                        index: i,
                        x: $$.isTimeSeries ? $$.getOtherTargetX(i) : i,
                        value: null
                    });
                }
                t.values.forEach(function (v) {
                    v.index += tail;
                    if (!$$.isTimeSeries) {
                        v.x += tail;
                    }
                });
                t.values = missing.concat(t.values);
            });
        }
        $$.data.targets = $$.data.targets.concat(targets); // add remained

        // check data count because behavior needs to change when it's only one
        dataCount = $$.getMaxDataCount();
        baseTarget = $$.data.targets[0];
        baseValue = baseTarget.values[0];

        // Update length to flow if needed
        if ($$.isDefined(args.to)) {
            length = 0;
            to = $$.isTimeSeries ? $$.parseDate(args.to) : args.to;
            baseTarget.values.forEach(function (v) {
                if (v.x < to) { length++; }
            });
        } else if ($$.isDefined(args.length)) {
            length = args.length;
        }

        // If only one data, update the domain to flow from left edge of the chart
        if (!orgDataCount) {
            if ($$.isTimeSeries) {
                if (baseTarget.values.length > 1) {
                    diff = baseTarget.values[baseTarget.values.length - 1].x - baseValue.x;
                } else {
                    diff = baseValue.x - $$.getXDomain($$.data.targets)[0];
                }
            } else {
                diff = 1;
            }
            domain = [baseValue.x - diff, baseValue.x];
            $$.updateXDomain(null, true, true, domain);
        } else if (orgDataCount === 1) {
            if ($$.isTimeSeries) {
                diff = (baseTarget.values[baseTarget.values.length - 1].x - baseValue.x) / 2;
                domain = [new Date(+baseValue.x - diff), new Date(+baseValue.x + diff)];
                $$.updateXDomain(null, true, true, domain);
            }
        }

        // Set targets
        $$.updateTargets($$.data.targets);

        // Redraw with new targets
        $$.redraw({
            flow: {
                index: baseValue.index,
                length: length,
                duration: $$.isValue(args.duration) ? args.duration : $$.__transition_duration,
                done: args.done,
                orgDataCount: orgDataCount,
            },
            withLegend: true,
            withTransition: orgDataCount > 1,
        });
    };

    c3.fn.chart.selected = function (targetId) {
        var $$ = this.$$, d3 = $$.d3, CLASS = $$.CLASS;
        return d3.merge(
            $$.main.selectAll('.' + CLASS.shapes + $$.getTargetSelectorSuffix(targetId)).selectAll('.' + CLASS.shape)
                .filter(function () { return d3.select(this).classed(CLASS.SELECTED); })
                .map(function (d) { return d.map(function (d) { var data = d.__data__; return data.data ? data.data : data; }); })
        );
    };
    c3.fn.chart.select = function (ids, indices, resetOther) {
        var $$ = this.$$, CLASS = $$.CLASS, d3 = $$.d3;
        if (! $$.__data_selection_enabled) { return; }
        $$.main.selectAll('.' + CLASS.shapes).selectAll('.' + CLASS.shape).each(function (d, i) {
            var shape = d3.select(this), id = d.data ? d.data.id : d.id, toggle = $$.getToggle(this),
                isTargetId = $$.__data_selection_grouped || !ids || ids.indexOf(id) >= 0,
                isTargetIndex = !indices || indices.indexOf(i) >= 0,
                isSelected = shape.classed(CLASS.SELECTED);
            // line/area selection not supported yet
            if (shape.classed(CLASS.line) || shape.classed(CLASS.area)) {
                return;
            }
            if (isTargetId && isTargetIndex) {
                if ($$.__data_selection_isselectable(d) && !isSelected) {
                    toggle(true, shape.classed(CLASS.SELECTED, true), d, i);
                }
            } else if ($$.isDefined(resetOther) && resetOther) {
                if (isSelected) {
                    toggle(false, shape.classed(CLASS.SELECTED, false), d, i);
                }
            }
        });
    };
    c3.fn.chart.unselect = function (ids, indices) {
        var $$ = this.$$, CLASS = $$.CLASS, d3 = $$.d3;
        if (! $$.__data_selection_enabled) { return; }
        $$.main.selectAll('.' + CLASS.shapes).selectAll('.' + CLASS.shape).each(function (d, i) {
            var shape = d3.select(this), id = d.data ? d.data.id : d.id, toggle = $$.getToggle(this),
                isTargetId = $$.__data_selection_grouped || !ids || ids.indexOf(id) >= 0,
                isTargetIndex = !indices || indices.indexOf(i) >= 0,
                isSelected = shape.classed(CLASS.SELECTED);
            // line/area selection not supported yet
            if (shape.classed(CLASS.line) || shape.classed(CLASS.area)) {
                return;
            }
            if (isTargetId && isTargetIndex) {
                if ($$.__data_selection_isselectable(d)) {
                    if (isSelected) {
                        toggle(false, shape.classed(CLASS.SELECTED, false), d, i);
                    }
                }
            }
        });
    };

    c3.fn.chart.transform = function (type, targetIds) {
        var $$ = this.$$,
            options = ['pie', 'donut'].indexOf(type) >= 0 ? {withTransform: true} : null;
        $$.transformTo(targetIds, type, options);
    };

    c3.fn.chart.groups = function (groups) {
        var $$ = this.$$;
        if ($$.isUndefined(groups)) { return $$.__data_groups; }
        $$.__data_groups = groups;
        $$.redraw();
        return $$.__data_groups;
    };

    c3.fn.chart.xgrids = function (grids) {
        var $$ = this.$$;
        if (! grids) { return $$.__grid_x_lines; }
        $$.__grid_x_lines = grids;
        $$.redraw();
        return $$.__grid_x_lines;
    };
    c3.fn.chart.xgrids.add = function (grids) {
        var $$ = this.$$;
        return this.xgrids($$.__grid_x_lines.concat(grids ? grids : []));
    };
    c3.fn.chart.xgrids.remove = function (params) { // TODO: multiple
        var $$ = this.$$;
        $$.removeGridLines(params, true);
    };

    c3.fn.chart.ygrids = function (grids) {
        var $$ = this.$$;
        if (! grids) { return $$.__grid_y_lines; }
        $$.__grid_y_lines = grids;
        $$.redraw();
        return $$.__grid_y_lines;
    };
    c3.fn.chart.ygrids.add = function (grids) {
        var $$ = this.$$;
        return c3.ygrids($$.__grid_y_lines.concat(grids ? grids : []));
    };
    c3.fn.chart.ygrids.remove = function (params) { // TODO: multiple
        var $$ = this.$$;
        $$.removeGridLines(params, false);
    };

    c3.fn.chart.regions = function (regions) {
        var $$ = this.$$;
        if (!regions) { return $$.__regions; }
        $$.__regions = regions;
        $$.redraw();
        return $$.__regions;
    };
    c3.fn.chart.regions.add = function (regions) {
        var $$ = this.$$;
        if (!regions) { return $$.__regions; }
        $$.__regions = $$.__regions.concat(regions);
        $$.redraw();
        return $$.__regions;
    };
    c3.fn.chart.regions.remove = function (options) {
        var $$ = this.$$, CLASS = $$.CLASS,
            duration, classes, regions;

        options = options || {};
        duration = $$.getOption(options, "duration", $$.__transition_duration);
        classes = $$.getOption(options, "classes", [CLASS.region]);

        regions = $$.main.select('.' + CLASS.regions).selectAll(classes.map(function (c) { return '.' + c; }));
        (duration ? regions.transition().duration(duration) : regions)
            .style('opacity', 0)
            .remove();

        $$.__regions = $$.__regions.filter(function (region) {
            var found = false;
            if (!region.class) {
                return true;
            }
            region.class.split(' ').forEach(function (c) {
                if (classes.indexOf(c) >= 0) { found = true; }
            });
            return !found;
        });

        return $$.__regions;
    };

    c3.fn.chart.data = function () {
    };
    c3.fn.chart.data.get = function (targetId) {
        var $$ = this.$$,
            target = this.data.getAsTarget(targetId);
        return $$.isDefined(target) ? target.values.map(function (d) { return d.value; }) : undefined;
    };
    c3.fn.chart.data.getAsTarget = function (targetId) {
        var targets = this.data.targets.filter(function (t) { return t.id === targetId; });
        return targets.length > 0 ? targets[0] : undefined;
    };
    c3.fn.chart.data.names = function (names) {
        var $$ = this.$$;
        if (!arguments.length) { return $$.__data_names; }
        Object.keys(names).forEach(function (id) {
            $$.__data_names[id] = names[id];
        });
        $$.redraw({withLegend: true});
        return $$.__data_names;
    };
    c3.fn.chart.data.colors = function (colors) {
        var $$ = this.$$;
        if (!arguments.length) { return $$.__data_colors; }
        Object.keys(colors).forEach(function (id) {
            $$.__data_colors[id] = colors[id];
        });
        $$.redraw({withLegend: true});
        return $$.__data_colors;
    };
    c3.fn.chart.category = function (i, category) {
        var $$ = this.$$;
        if (arguments.length > 1) {
            $$.__axis_x_categories[i] = category;
            $$.redraw();
        }
        return $$.__axis_x_categories[i];
    };
    c3.fn.chart.categories = function (categories) {
        var $$ = this.$$;
        if (!arguments.length) { return $$.__axis_x_categories; }
        $$.__axis_x_categories = categories;
        $$.redraw();
        return $$.__axis_x_categories;
    };

    // TODO: fix
    c3.fn.chart.color = function (id) {
        var $$ = this.$$;
        return $$.color(id); // more patterns
    };

    c3.fn.chart.x = function (x) {
        var $$ = this.$$;
        if (arguments.length) {
            $$.updateTargetX($$.data.targets, x);
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true});
        }
        return $$.data.xs;
    };
    c3.fn.chart.xs = function (xs) {
        var $$ = this.$$;
        if (arguments.length) {
            $$.updateTargetXs($$.data.targets, xs);
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true});
        }
        return $$.data.xs;
    };


    c3.fn.chart.axis = function () {
    };
    c3.fn.chart.axis.labels = function (labels) {
        var $$ = this.$$;
        if (arguments.length) {
            Object.keys(labels).forEach(function (axisId) {
                $$.setAxisLabelText(axisId, labels[axisId]);
            });
            $$.updateAxisLabels();
        }
        // TODO: return some values?
    };
    c3.fn.chart.axis.max = function (max) {
        var $$ = this.$$;
        if (arguments.length) {
            if (typeof max === 'object') {
                if ($$.isValue(max.x)) { $$.__axis_x_max = max.x; }
                if ($$.isValue(max.y)) { $$.__axis_y_max = max.y; }
                if ($$.isValue(max.y2)) { $$.__axis_y2_max = max.y2; }
            } else {
                $$.__axis_y_max = $$.__axis_y2_max = max;
            }
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true});
        }
    };
    c3.fn.chart.axis.min = function (min) {
        var $$ = this.$$;
        if (arguments.length) {
            if (typeof min === 'object') {
                if ($$.isValue(min.x)) { $$.__axis_x_min = min.x; }
                if ($$.isValue(min.y)) { $$.__axis_y_min = min.y; }
                if ($$.isValue(min.y2)) { $$.__axis_y2_min = min.y2; }
            } else {
                $$.__axis_y_min = $$.__axis_y2_min = min;
            }
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true});
        }
    };
    c3.fn.chart.axis.range = function (range) {
        var $$ = this.$$;
        if (arguments.length) {
            if (typeof range.max !== 'undefined') { this.axis.max(range.max); }
            if (typeof range.min !== 'undefined') { this.axis.min(range.min); }
        }
    };


    c3.fn.chart.legend = function () {
    };
    c3.fn.chart.legend.show = function (targetIds) {
        var $$ = this.$$;
        $$.showLegend($$.mapToTargetIds(targetIds));
        $$.updateAndRedraw({withLegend: true});
    };
    c3.fn.chart.legend.hide = function (targetIds) {
        var $$ = this.$$;
        $$.hideLegend($$.mapToTargetIds(targetIds));
        $$.updateAndRedraw({withLegend: true});
    };

    c3.fn.chart.resize = function (size) {
        var $$ = this.$$;
        $$.__size_width = size ? size.width : null;
        $$.__size_height = size ? size.height : null;
        this.flush();
    };

    c3.fn.chart.flush = function () {
        var $$ = this.$$;
        $$.updateAndRedraw({withLegend: true, withTransition: false, withTransitionForTransform: false});
    };

    c3.fn.chart.destroy = function () {
        var $$ = this.$$;
        $$.data.targets = undefined;
        $$.data.xs = {};
        $$.selectChart.classed('c3', false).html("");
        window.onresize = null;
    };



    /**
     *  c3.axis.js
     */
    // Features:
    // 1. category axis
    // 2. ceil values of translate/x/y to int for half pixel antialiasing
    function c3_axis(d3, isCategory) {
        var scale = d3.scale.linear(), orient = "bottom", innerTickSize = 6, outerTickSize = 6, tickPadding = 3, tickValues = null, tickFormat, tickArguments;

        var tickOffset = 0, tickCulling = true, tickCentered;

        function axisX(selection, x) {
            selection.attr("transform", function (d) {
                return "translate(" + Math.ceil(x(d) + tickOffset) + ", 0)";
            });
        }
        function axisY(selection, y) {
            selection.attr("transform", function (d) {
                return "translate(0," + Math.ceil(y(d)) + ")";
            });
        }
        function scaleExtent(domain) {
            var start = domain[0], stop = domain[domain.length - 1];
            return start < stop ? [ start, stop ] : [ stop, start ];
        }
        function generateTicks(scale) {
            var i, domain, ticks = [];
            if (scale.ticks) {
                return scale.ticks.apply(scale, tickArguments);
            }
            domain = scale.domain();
            for (i = Math.ceil(domain[0]); i < domain[1]; i++) {
                ticks.push(i);
            }
            if (ticks.length > 0 && ticks[0] > 0) {
                ticks.unshift(ticks[0] - (ticks[1] - ticks[0]));
            }
            return ticks;
        }
        function copyScale() {
            var newScale = scale.copy(), domain;
            if (isCategory) {
                domain = scale.domain();
                newScale.domain([domain[0], domain[1] - 1]);
            }
            return newScale;
        }
        function textFormatted(v) {
            return tickFormat ? tickFormat(v) : v;
        }
        function axis(g) {
            g.each(function () {
                var g = d3.select(this);
                var scale0 = this.__chart__ || scale, scale1 = this.__chart__ = copyScale();

                var ticks = tickValues ? tickValues : generateTicks(scale1),
                    tick = g.selectAll(".tick").data(ticks, scale1),
                    tickEnter = tick.enter().insert("g", ".domain").attr("class", "tick").style("opacity", 1e-6),
                    // MEMO: No exit transition. The reason is this transition affects max tick width calculation because old tick will be included in the ticks.
                    tickExit = tick.exit().remove(),
                    tickUpdate = d3.transition(tick).style("opacity", 1),
                    tickTransform, tickX;

                var range = scale.rangeExtent ? scale.rangeExtent() : scaleExtent(scale.range()),
                    path = g.selectAll(".domain").data([ 0 ]),
                    pathUpdate = (path.enter().append("path").attr("class", "domain"), d3.transition(path));
                tickEnter.append("line");
                tickEnter.append("text");

                var lineEnter = tickEnter.select("line"),
                    lineUpdate = tickUpdate.select("line"),
                    text = tick.select("text").text(textFormatted),
                    textEnter = tickEnter.select("text"),
                    textUpdate = tickUpdate.select("text");

                if (isCategory) {
                    tickOffset = Math.ceil((scale1(1) - scale1(0)) / 2);
                    tickX = tickCentered ? 0 : tickOffset;
                } else {
                    tickOffset = tickX = 0;
                }

                function tickSize(d) {
                    var tickPosition = scale(d) + tickOffset;
                    return range[0] < tickPosition && tickPosition < range[1] ? innerTickSize : 0;
                }

                switch (orient) {
                case "bottom":
                    {
                        tickTransform = axisX;
                        lineEnter.attr("y2", innerTickSize);
                        textEnter.attr("y", Math.max(innerTickSize, 0) + tickPadding);
                        lineUpdate.attr("x1", tickX).attr("x2", tickX).attr("y2", tickSize);
                        textUpdate.attr("x", 0).attr("y", Math.max(innerTickSize, 0) + tickPadding);
                        text.attr("dy", ".71em").style("text-anchor", "middle");
                        pathUpdate.attr("d", "M" + range[0] + "," + outerTickSize + "V0H" + range[1] + "V" + outerTickSize);
                        break;
                    }
                case "top":
                    {
                        tickTransform = axisX;
                        lineEnter.attr("y2", -innerTickSize);
                        textEnter.attr("y", -(Math.max(innerTickSize, 0) + tickPadding));
                        lineUpdate.attr("x2", 0).attr("y2", -innerTickSize);
                        textUpdate.attr("x", 0).attr("y", -(Math.max(innerTickSize, 0) + tickPadding));
                        text.attr("dy", "0em").style("text-anchor", "middle");
                        pathUpdate.attr("d", "M" + range[0] + "," + -outerTickSize + "V0H" + range[1] + "V" + -outerTickSize);
                        break;
                    }
                case "left":
                    {
                        tickTransform = axisY;
                        lineEnter.attr("x2", -innerTickSize);
                        textEnter.attr("x", -(Math.max(innerTickSize, 0) + tickPadding));
                        lineUpdate.attr("x2", -innerTickSize).attr("y2", 0);
                        textUpdate.attr("x", -(Math.max(innerTickSize, 0) + tickPadding)).attr("y", tickOffset);
                        text.attr("dy", ".32em").style("text-anchor", "end");
                        pathUpdate.attr("d", "M" + -outerTickSize + "," + range[0] + "H0V" + range[1] + "H" + -outerTickSize);
                        break;
                    }
                case "right":
                    {
                        tickTransform = axisY;
                        lineEnter.attr("x2", innerTickSize);
                        textEnter.attr("x", Math.max(innerTickSize, 0) + tickPadding);
                        lineUpdate.attr("x2", innerTickSize).attr("y2", 0);
                        textUpdate.attr("x", Math.max(innerTickSize, 0) + tickPadding).attr("y", 0);
                        text.attr("dy", ".32em").style("text-anchor", "start");
                        pathUpdate.attr("d", "M" + outerTickSize + "," + range[0] + "H0V" + range[1] + "H" + outerTickSize);
                        break;
                    }
                }
                if (scale1.rangeBand) {
                    var x = scale1, dx = x.rangeBand() / 2;
                    scale0 = scale1 = function (d) {
                        return x(d) + dx;
                    };
                } else if (scale0.rangeBand) {
                    scale0 = scale1;
                } else {
                    tickExit.call(tickTransform, scale1);
                }
                tickEnter.call(tickTransform, scale0);
                tickUpdate.call(tickTransform, scale1);
            });
        }
        axis.scale = function (x) {
            if (!arguments.length) { return scale; }
            scale = x;
            return axis;
        };
        axis.orient = function (x) {
            if (!arguments.length) { return orient; }
            orient = x in {top: 1, right: 1, bottom: 1, left: 1} ? x + "" : "bottom";
            return axis;
        };
        axis.tickFormat = function (format) {
            if (!arguments.length) { return tickFormat; }
            tickFormat = format;
            return axis;
        };
        axis.tickCentered = function (isCentered) {
            if (!arguments.length) { return tickCentered; }
            tickCentered = isCentered;
            return axis;
        };
        axis.tickOffset = function () { // This will be overwritten when normal x axis
            return tickOffset;
        };
        axis.ticks = function () {
            if (!arguments.length) { return tickArguments; }
            tickArguments = arguments;
            return axis;
        };
        axis.tickCulling = function (culling) {
            if (!arguments.length) { return tickCulling; }
            tickCulling = culling;
            return axis;
        };
        axis.tickValues = function (x) {
            if (!arguments.length) { return tickValues; }
            tickValues = x;
            return axis;
        };
        return axis;
    }


})(window.c3);
