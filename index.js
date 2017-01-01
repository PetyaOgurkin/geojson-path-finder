var findPath = require('./dijkstra'),
    topology = require('./topology'),
    compactor = require('./compactor')
    point = require('turf-point'),
    distance = require('turf-distance');

module.exports = PathFinder;

function PathFinder(geojson, options) {
    options = options || {};
    
    var topo = this._topo = topology(geojson, options),
        weightFn = options.weightFn || function(a, b) {
            return distance(point(a), point(b));
        };

    this._keyFn = options.keyFn || function(c) {
        return c.join(',');
    };
    this._precision = options.precision || 1e-5;

    this._vertices = topo.edges.reduce(function(g, edge) {
        var a = edge[0],
            b = edge[1],
            props = edge[2],
            w = weightFn(topo.vertices[a], topo.vertices[b], props),
            makeEdgeList = function(node) {
                if (!g[node]) {
                    g[node] = {};
                }
            },
            concatEdge = function(startNode, endNode, weight) {
                var v = g[startNode];
                v[endNode] = weight;
            };

        makeEdgeList(a);
        makeEdgeList(b);
        if (w) {
            if (w instanceof Object) {
                if (w.forward) {
                    concatEdge(a, b, w.forward);
                }
                if (w.backward) {
                    concatEdge(b, a, w.backward);
                }
            } else {
                concatEdge(a, b, w);
                concatEdge(b, a, w);
            }
        }

        return g;
    }, {});

    this._compact = compactor.compactGraph(this._vertices, this._topo.vertices);

    if (Object.keys(this._compact.graph).length === 0) {
        throw new Error('Compacted graph contains no forks (topology has no intersections).');
    }
}

PathFinder.prototype = {
    findPath: function(a, b) {
        var start = this._keyFn(this._roundCoord(a.geometry.coordinates)),
            finish = this._keyFn(this._roundCoord(b.geometry.coordinates));

        var phantomStart = this._createPhantom(start);
        var phantomEnd = this._createPhantom(finish);

        var path = findPath(this._compact.graph, start, finish);

        if (path) {
            var weight = path[0];
            path = path[1];
            return {
                path: path.reduce(function(cs, v, i, vs) {
                    if (i > 0) {
                        cs = cs.concat(this._compact.coordinates[vs[i - 1]][v]);
                    }

                    return cs;
                }.bind(this), []).concat([this._topo.vertices[finish]]),
                weight: weight
            };
        } else {
            return null;
        }

        this._removePhantom(phantomStart);
        this._removePhantom(phantomEnd);
    },

    _roundCoord: function(c) {
        return c.map(function(c) {
            return Math.round(c / this._precision) * this._precision;
        }.bind(this));
    },

    _createPhantom: function(n) {
        if (this._compact.graph[n]) return null;

        var phantom = compactor.compactNode(n, this._vertices, this._compact.graph, this._topo.vertices);
        this._compact.graph[n] = phantom.edges;
        this._compact.coordinates[n] = phantom.coordinates;

        Object.keys(phantom.incomingEdges).forEach(function(neighbor) {
            this._compact.graph[neighbor][n] = phantom.incomingEdges[neighbor];
            this._compact.coordinates[neighbor][n] = phantom.incomingCoordinates[neighbor];
        }.bind(this));

        return n;
    },

    _removePhantom: function(n) {
        if (!n) return;

        Object.keys(this._compact.graph[n]).forEach(function(neighbor) {
            delete this._compact.graph[neighbor][n];
        }.bind(this));
        Object.keys(this._compact.coordinates[n]).forEach(function(neighbor) {
            delete this._compact.coordinates[neighbor][n];
        }.bind(this));

        delete this._compact.graph[n];
        delete this._compact.coordinates[n];
    }
};
