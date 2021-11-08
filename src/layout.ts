import { Graph } from "graphlib"

import * as acyclic from "./acyclic.js"
import * as normalize from "./normalize.js"
import * as rank from "./rank.js"

import {
	normalizeRanks,
	removeEmptyRanks,
	asNonCompoundGraph,
	addDummyNode,
	intersectRect,
	buildLayerMatrix,
} from "./util.js"

import * as parentDummyChains from "./parent-dummy-chains.js"
import * as position from "./position.js"
import * as order from "./order.js"
import * as coordinateSystem from "./coordinate-system.js"
import * as addBorderSegments from "./add-border-segments.js"
import * as nestingGraph from "./nesting-graph.js"

// var util = require("./util");

export interface GraphLabel {
	width?: number | undefined
	height?: number | undefined
	compound?: boolean | undefined
	rankdir?: string | undefined
	align?: string | undefined
	nodesep?: number | undefined
	edgesep?: number | undefined
	ranksep?: number | undefined
	marginx?: number | undefined
	marginy?: number | undefined
	acyclicer?: string | undefined
	ranker?: string | undefined
}

export interface InputNodeLabel {
	width?: number | undefined
	height?: number | undefined
}

export interface InputEdgeLabel {
	minlen?: number | undefined
	weight?: number | undefined
	width?: number | undefined
	height?: number | undefined
	lablepos?: "l" | "c" | "r" | undefined
	labeloffest?: number | undefined
}

interface OutputNodeLabel extends InputNodeLabel {
	x: number
	y: number
}

interface OutputEdgeLabel extends InputEdgeLabel {
	sx: number
	sy: number
	tx: number
	ty: number
}

type InputGraph = Graph<GraphLabel, InputNodeLabel, InputEdgeLabel>

type LayoutGraph = Graph<GraphLabel, OutputNodeLabel, OutputEdgeLabel>

export function layout(
	g: InputGraph,
	opts?: GraphLabel & InputNodeLabel & InputEdgeLabel
) {
	const layoutGraph = buildLayoutGraph(g)
	runLayout(layoutGraph)
	updateInputGraph(g, layoutGraph)
	return layoutGraph
}

function runLayout(g: LayoutGraph) {
	makeSpaceForEdgeLabels(g)
	removeSelfEdges(g)
	acyclic.run(g)
	nestingGraph.run(g)
	rank(asNonCompoundGraph(g))
	injectEdgeLabelProxies(g)
	removeEmptyRanks(g)
	nestingGraph.cleanup(g)
	normalizeRanks(g)
	assignRankMinMax(g)
	removeEdgeLabelProxies(g)
	normalize.run(g)
	parentDummyChains(g)
	addBorderSegments(g)
	order(g)
	insertSelfEdges(g)
	coordinateSystem.adjust(g)
	position(g)
	positionSelfEdges(g)
	removeBorderNodes(g)
	normalize.undo(g)
	fixupEdgeLabelCoords(g)
	coordinateSystem.undo(g)
	translateGraph(g)
	assignNodeIntersects(g)
	reversePointsForReversedEdges(g)
	acyclic.undo(g)
}

/*
 * Copies final layout information from the layout graph back to the input
 * graph. This process only copies whitelisted attributes from the layout graph
 * to the input graph, so it serves as a good place to determine what
 * attributes can influence layout.
 */
function updateInputGraph(inputGraph: Graph, layoutGraph: Graph) {
	for (const v of inputGraph.nodes()) {
		const inputLabel = inputGraph.node(v)
		const layoutLabel = layoutGraph.node(v)

		if (inputLabel) {
			inputLabel.x = layoutLabel.x
			inputLabel.y = layoutLabel.y

			if (layoutGraph.children(v).length) {
				inputLabel.width = layoutLabel.width
				inputLabel.height = layoutLabel.height
			}
		}
	}

	for (const e of inputGraph.edges()) {
		const inputLabel = inputGraph.edge(e)
		const layoutLabel = layoutGraph.edge(e)

		inputLabel.points = layoutLabel.points
		if ("x" in layoutLabel) {
			inputLabel.x = layoutLabel.x
			inputLabel.y = layoutLabel.y
		}
	}

	inputGraph.graph().width = layoutGraph.graph().width
	inputGraph.graph().height = layoutGraph.graph().height
}

const graphNumAttrs = ["nodesep", "edgesep", "ranksep", "marginx", "marginy"]
const graphDefaults = { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: "tb" }
const graphAttrs = ["acyclicer", "ranker", "rankdir", "align"]
const nodeNumAttrs = ["width", "height"]
const nodeDefaults = { width: 0, height: 0 }
const edgeNumAttrs = ["minlen", "weight", "width", "height", "labeloffset"]
const edgeDefaults = {
	minlen: 1,
	weight: 1,
	width: 0,
	height: 0,
	labeloffset: 10,
	labelpos: "r",
}
const edgeAttrs = ["labelpos"]

/*
 * Constructs a new graph from the input graph, which can be used for layout.
 * This process copies only whitelisted attributes from the input graph to the
 * layout graph. Thus this function serves as a good place to determine what
 * attributes can influence layout.
 */
function buildLayoutGraph(inputGraph: InputGraph): LayoutGraph {
	const g = new Graph<GraphLabel, OutputNodeLabel, OutputEdgeLabel>(
		inputGraph.graph(),
		{ multigraph: true, compound: true }
	)
  
  const graphLabel = inputGraph.graph()
	// const graph = canonicalize(inputGraph.graph())

	g.setGraph(
		_.merge(
			{},
			graphDefaults,
			selectNumberAttrs(graph, graphNumAttrs),
			_.pick(graph, graphAttrs)
		)
	)

	for (const v of inputGraph.nodes()) {
		var node = canonicalize(inputGraph.node(v))
		g.setNode(
			v,
			_.defaults(selectNumberAttrs(node, nodeNumAttrs), nodeDefaults)
		)
		g.setParent(v, inputGraph.parent(v))
	}

	for (const e of inputGraph.edges()) {
		var edge = canonicalize(inputGraph.edge(e))
		g.setEdge(
			e,
			_.merge(
				{},
				edgeDefaults,
				selectNumberAttrs(edge, edgeNumAttrs),
				_.pick(edge, edgeAttrs)
			)
		)
	}

	return g
}

/*
 * This idea comes from the Gansner paper: to account for edge labels in our
 * layout we split each rank in half by doubling minlen and halving ranksep.
 * Then we can place labels at these mid-points between nodes.
 *
 * We also add some minimal padding to the width to push the label for the edge
 * away from the edge itself a bit.
 */
function makeSpaceForEdgeLabels(g: Graph) {
	var graph = g.graph()
	graph.ranksep /= 2
	for (const e of g.edges()) {
		const edge = g.edge(e)
		edge.minlen *= 2
		if (edge.labelpos.toLowerCase() !== "c") {
			if (graph.rankdir === "TB" || graph.rankdir === "BT") {
				edge.width += edge.labeloffset
			} else {
				edge.height += edge.labeloffset
			}
		}
	}
}

/*
 * Creates temporary dummy nodes that capture the rank in which each edge's
 * label is going to, if it has one of non-zero width and height. We do this
 * so that we can safely remove empty ranks while preserving balance for the
 * label's position.
 */
function injectEdgeLabelProxies(g: Graph) {
	for (const e of g.edges()) {
		const edge = g.edge(e)
		if (edge.width && edge.height) {
			var v = g.node(e.v)
			var w = g.node(e.w)
			var label = { rank: (w.rank - v.rank) / 2 + v.rank, e: e }
			addDummyNode(g, "edge-proxy", label, "_ep")
		}
	}
}

function assignRankMinMax(g: Graph) {
	var maxRank = 0
	for (const v of g.nodes()) var node = g.node(v)
	if (node.borderTop) {
		node.minRank = g.node(node.borderTop).rank
		node.maxRank = g.node(node.borderBottom).rank
		maxRank = _.max(maxRank, node.maxRank)
	}

	g.graph().maxRank = maxRank
}

function removeEdgeLabelProxies(g: Graph) {
	for (const v of g.nodes()) {
		const node = g.node(v)
		if (node.dummy === "edge-proxy") {
			g.edge(node.e).labelRank = node.rank
			g.removeNode(v)
		}
	}
}

function translateGraph(g: Graph) {
	let minX = Number.POSITIVE_INFINITY
	let maxX = 0
	let minY = Number.POSITIVE_INFINITY
	let maxY = 0
	const graphLabel = g.graph()
	const marginX = graphLabel.marginx || 0
	const marginY = graphLabel.marginy || 0

	function getExtremes({ x, y, width: w, height: h }) {
		minX = Math.min(minX, x - w / 2)
		maxX = Math.max(maxX, x + w / 2)
		minY = Math.min(minY, y - h / 2)
		maxY = Math.max(maxY, y + h / 2)
	}

	for (const v of g.nodes()) {
		getExtremes(g.node(v))
	}

	for (const e of g.edges()) {
		const edge = g.edge(e)
		if ("x" in edge) {
			getExtremes(edge)
		}
	}

	minX -= marginX
	minY -= marginY

	for (const v of g.nodes()) {
		const node = g.node(v)
		node.x -= minX
		node.y -= minY
	}

	for (const e of g.edges()) {
		const edge = g.edge(e)
		for (const p of edge.points) {
			p.x -= minX
			p.y -= minY
		}
		if (edge.x !== undefined) {
			edge.x -= minX
		}
		if (edge.y !== undefined) {
			edge.y -= minY
		}
	}

	// _.forEach(g.edges(), function (e) {})

	graphLabel.width = maxX - minX + marginX
	graphLabel.height = maxY - minY + marginY
}

function assignNodeIntersects(g: Graph) {
	_.forEach(g.edges(), function (e) {
		var edge = g.edge(e)
		var nodeV = g.node(e.v)
		var nodeW = g.node(e.w)
		var p1, p2
		if (!edge.points) {
			edge.points = []
			p1 = nodeW
			p2 = nodeV
		} else {
			p1 = edge.points[0]
			p2 = edge.points[edge.points.length - 1]
		}
		edge.points.unshift(intersectRect(nodeV, p1))
		edge.points.push(intersectRect(nodeW, p2))
	})
}

function fixupEdgeLabelCoords(g: Graph) {
	_.forEach(g.edges(), function (e) {
		var edge = g.edge(e)
		if (_.has(edge, "x")) {
			if (edge.labelpos === "l" || edge.labelpos === "r") {
				edge.width -= edge.labeloffset
			}
			switch (edge.labelpos) {
				case "l":
					edge.x -= edge.width / 2 + edge.labeloffset
					break
				case "r":
					edge.x += edge.width / 2 + edge.labeloffset
					break
			}
		}
	})
}

function reversePointsForReversedEdges(g: Graph) {
	_.forEach(g.edges(), function (e) {
		var edge = g.edge(e)
		if (edge.reversed) {
			edge.points.reverse()
		}
	})
}

function removeBorderNodes(g: Graph) {
	_.forEach(g.nodes(), function (v) {
		if (g.children(v).length) {
			var node = g.node(v)
			var t = g.node(node.borderTop)
			var b = g.node(node.borderBottom)
			var l = g.node(_.last(node.borderLeft))
			var r = g.node(_.last(node.borderRight))

			node.width = Math.abs(r.x - l.x)
			node.height = Math.abs(b.y - t.y)
			node.x = l.x + node.width / 2
			node.y = t.y + node.height / 2
		}
	})

	_.forEach(g.nodes(), function (v) {
		if (g.node(v).dummy === "border") {
			g.removeNode(v)
		}
	})
}

function removeSelfEdges(g: Graph) {
	_.forEach(g.edges(), function (e) {
		if (e.v === e.w) {
			var node = g.node(e.v)
			if (!node.selfEdges) {
				node.selfEdges = []
			}
			node.selfEdges.push({ e: e, label: g.edge(e) })
			g.removeEdge(e)
		}
	})
}

function insertSelfEdges(g: Graph) {
	var layers = buildLayerMatrix(g)
	_.forEach(layers, function (layer) {
		var orderShift = 0
		_.forEach(layer, function (v, i) {
			var node = g.node(v)
			node.order = i + orderShift
			_.forEach(node.selfEdges, function (selfEdge) {
				addDummyNode(
					g,
					"selfedge",
					{
						width: selfEdge.label.width,
						height: selfEdge.label.height,
						rank: node.rank,
						order: i + ++orderShift,
						e: selfEdge.e,
						label: selfEdge.label,
					},
					"_se"
				)
			})
			delete node.selfEdges
		})
	})
}

function positionSelfEdges(g: Graph) {
	_.forEach(g.nodes(), function (v) {
		var node = g.node(v)
		if (node.dummy === "selfedge") {
			var selfNode = g.node(node.e.v)
			var x = selfNode.x + selfNode.width / 2
			var y = selfNode.y
			var dx = node.x - x
			var dy = selfNode.height / 2
			g.setEdge(node.e, node.label)
			g.removeNode(v)
			node.label.points = [
				{ x: x + (2 * dx) / 3, y: y - dy },
				{ x: x + (5 * dx) / 6, y: y - dy },
				{ x: x + dx, y: y },
				{ x: x + (5 * dx) / 6, y: y + dy },
				{ x: x + (2 * dx) / 3, y: y + dy },
			]
			node.label.x = node.x
			node.label.y = node.y
		}
	})
}

function selectNumberAttrs(obj, attrs) {
	return _.mapValues(_.pick(obj, attrs), Number)
}

const canonicalize = <T>(attrs: Record<string, T>): Record<string, T> =>
	Object.fromEntries(
		Object.entries(attrs).map(([key, value]) => [key.toLowerCase(), value])
	)
