interface AcNode {
	next: Map<string, number>;
	fail: number;
	outputs: string[];
}

export interface AcHit {
	start: number;
	end: number;
	term: string;
}

export class AhoCorasick {
	private readonly nodes: AcNode[] = [{ next: new Map(), fail: 0, outputs: [] }];

	add(term: string): void {
		if (!term) {
			return;
		}
		let id = 0;
		for (const ch of term) {
			const node = this.nodes[id]!;
			let nxt = node.next.get(ch);
			if (nxt === undefined) {
				nxt = this.nodes.length;
				node.next.set(ch, nxt);
				this.nodes.push({ next: new Map(), fail: 0, outputs: [] });
			}
			id = nxt;
		}
		this.nodes[id]!.outputs.push(term);
	}

	build(): void {
		const queue: number[] = [];
		for (const nxt of this.nodes[0]!.next.values()) {
			this.nodes[nxt]!.fail = 0;
			queue.push(nxt);
		}
		let head = 0;
		while (head < queue.length) {
			const id = queue[head++]!;
			const node = this.nodes[id]!;
			for (const [ch, nxt] of node.next) {
				queue.push(nxt);
				let f = node.fail;
				while (f > 0 && !this.nodes[f]!.next.has(ch)) {
					f = this.nodes[f]!.fail;
				}
				const failTo = this.nodes[f]!.next.get(ch);
				this.nodes[nxt]!.fail = failTo !== undefined && failTo !== nxt ? failTo : 0;
				const failOutputs = this.nodes[this.nodes[nxt]!.fail]!.outputs;
				if (failOutputs.length > 0) {
					this.nodes[nxt]!.outputs = this.nodes[nxt]!.outputs.concat(failOutputs);
				}
			}
		}
	}

	find(text: string): AcHit[] {
		const hits: AcHit[] = [];
		let id = 0;
		let index = 0;
		for (const ch of text) {
			while (id > 0 && !this.nodes[id]!.next.has(ch)) {
				id = this.nodes[id]!.fail;
			}
			const nxt = this.nodes[id]!.next.get(ch);
			if (nxt !== undefined) {
				id = nxt;
			}
			const outputs = this.nodes[id]!.outputs;
			if (outputs.length > 0) {
				const end = index + ch.length;
				for (const term of outputs) {
					hits.push({ start: end - term.length, end, term });
				}
			}
			index += ch.length;
		}
		return hits;
	}
}
