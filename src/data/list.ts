/*
 * Simple doubly linked list implementation derived from Cormen, et al.,
 * "Introduction to Algorithms".
 */

type Sentinel = { _next?: Sentinel; _prev?: Sentinel }

export class List {
	private _sentinel: Sentinel
	constructor() {
		this._sentinel = {}
		this._sentinel._prev = this._sentinel
		this._sentinel._next = this._sentinel
	}

	dequeue() {
		var sentinel = this._sentinel
		var entry = sentinel._prev
		if (entry !== sentinel) {
			unlink(entry)
			return entry
		}
	}

	enqueue(entry) {}
}

List.prototype.enqueue = function (entry) {
	var sentinel = this._sentinel
	if (entry._prev && entry._next) {
		unlink(entry)
	}
	entry._next = sentinel._next
	sentinel._next._prev = entry
	sentinel._next = entry
	entry._prev = sentinel
}

List.prototype.toString = function () {
	var strs = []
	var sentinel = this._sentinel
	var curr = sentinel._prev
	while (curr !== sentinel) {
		strs.push(JSON.stringify(curr, filterOutLinks))
		curr = curr._prev
	}
	return "[" + strs.join(", ") + "]"
}

function unlink(entry: Sentinel) {
	entry._prev._next = entry._next
	entry._next._prev = entry._prev
	// delete entry._next
	// delete entry._prev
}

function filterOutLinks(k, v) {
	if (k !== "_next" && k !== "_prev") {
		return v
	}
}
