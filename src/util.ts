import { Graph } from "graphlib"

/*
 * Adds a dummy node to the graph and return v.
 */
export function addDummyNode(g: Graph, type, attrs, name) {
	var v
	do {
		v = _.uniqueId(name)
	} while (g.hasNode(v))

	attrs.dummy = type
	g.setNode(v, attrs)
	return v
}

/*
 * Returns a new graph with only simple edges. Handles aggregation of data
 * associated with multi-edges.
 */
export function simplify(g: Graph): Graph {
	const simplified = new Graph().setGraph(g.graph())
	for (const v of g.nodes()) {
		simplified.setNode(v, g.node(v))
	}

	for (const e of g.edges()) {
		const simpleLabel = simplified.edge(e.v, e.w) || { weight: 0, minlen: 1 }
		const label = g.edge(e)
		simplified.setEdge(e.v, e.w, {
			weight: simpleLabel.weight + label.weight,
			minlen: Math.max(simpleLabel.minlen, label.minlen),
		})
	}

	return simplified
}

export function asNonCompoundGraph(g: Graph): Graph {
	const simplified = new Graph({ multigraph: g.isMultigraph() }).setGraph(
		g.graph()
	)

	for (const v of g.nodes()) {
		if (!g.children(v).length) {
			simplified.setNode(v, g.node(v))
		}
	}

	for (const e of g.edges()) {
		simplified.setEdge(e, g.edge(e))
	}

	return simplified
}

export function successorWeights(g) {
	var weightMap = _.map(g.nodes(), function (v) {
		var sucs = {}
		_.forEach(g.outEdges(v), function (e) {
			sucs[e.w] = (sucs[e.w] || 0) + g.edge(e).weight
		})
		return sucs
	})
	return _.zipObject(g.nodes(), weightMap)
}

export function predecessorWeights(g) {
	var weightMap = _.map(g.nodes(), function (v) {
		var preds = {}
		_.forEach(g.inEdges(v), function (e) {
			preds[e.v] = (preds[e.v] || 0) + g.edge(e).weight
		})
		return preds
	})
	return _.zipObject(g.nodes(), weightMap)
}

/*
 * Finds where a line starting at point ({x, y}) would intersect a rectangle
 * ({x, y, width, height}) if it were pointing at the rectangle's center.
 */
export function intersectRect(rect, point) {
	var x = rect.x
	var y = rect.y

	// Rectangle intersection algorithm from:
	// http://math.stackexchange.com/questions/108113/find-edge-between-two-boxes
	var dx = point.x - x
	var dy = point.y - y
	var w = rect.width / 2
	var h = rect.height / 2

	if (!dx && !dy) {
		throw new Error("Not possible to find intersection inside of the rectangle")
	}

	var sx, sy
	if (Math.abs(dy) * w > Math.abs(dx) * h) {
		// Intersection is top or bottom of rect.
		if (dy < 0) {
			h = -h
		}
		sx = (h * dx) / dy
		sy = h
	} else {
		// Intersection is left or right of rect.
		if (dx < 0) {
			w = -w
		}
		sx = w
		sy = (w * dy) / dx
	}

	return { x: x + sx, y: y + sy }
}

/*
 * Given a DAG with each node assigned "rank" and "order" properties, this
 * function will produce a matrix with the ids of each node.
 */
export function buildLayerMatrix(g) {
	var layering = _.map(_.range(maxRank(g) + 1), function () {
		return []
	})
	_.forEach(g.nodes(), function (v) {
		var node = g.node(v)
		var rank = node.rank
		if (!_.isUndefined(rank)) {
			layering[rank][node.order] = v
		}
	})
	return layering
}

/*
 * Adjusts the ranks for all nodes in the graph such that all nodes v have
 * rank(v) >= 0 and at least one node w has rank(w) = 0.
 */
export function normalizeRanks(g: Graph) {
	var min = _.min(
		_.map(g.nodes(), function (v) {
			return g.node(v).rank
		})
	)
	_.forEach(g.nodes(), function (v) {
		var node = g.node(v)
		if (_.has(node, "rank")) {
			node.rank -= min
		}
	})
}

export function removeEmptyRanks(g: Graph) {
	// Ranks may not start at 0, so we need to offset them
	var offset = _.min(
		_.map(g.nodes(), function (v) {
			return g.node(v).rank
		})
	)

	var layers = []
	_.forEach(g.nodes(), function (v) {
		var rank = g.node(v).rank - offset
		if (!layers[rank]) {
			layers[rank] = []
		}
		layers[rank].push(v)
	})

	var delta = 0
	var nodeRankFactor = g.graph().nodeRankFactor
	_.forEach(layers, function (vs, i) {
		if (_.isUndefined(vs) && i % nodeRankFactor !== 0) {
			--delta
		} else if (delta) {
			_.forEach(vs, function (v) {
				g.node(v).rank += delta
			})
		}
	})
}

export function addBorderNode(g: Graph, prefix, rank, order) {
	const node = { width: 0, height: 0 }
	if (arguments.length >= 4) {
		node.rank = rank
		node.order = order
	}
	return addDummyNode(g, "border", node, prefix)
}

export function maxRank(g: Graph) {
	let max = 0
	for (const v of g.nodes()) {
		const { rank } = g.node(v)
		if (rank !== undefined && rank > max) {
			max = rank
		}
	}
	return max
}

/*
 * Partition a collection into two groups: `lhs` and `rhs`. If the supplied
 * function returns true for an entry it goes into `lhs`. Otherwise it goes
 * into `rhs.
 */
export function partition(collection, fn) {
	var result = { lhs: [], rhs: [] }
	_.forEach(collection, function (value) {
		if (fn(value)) {
			result.lhs.push(value)
		} else {
			result.rhs.push(value)
		}
	})
	return result
}
