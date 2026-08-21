const SVG_NS = 'http://www.w3.org/2000/svg';

function pixel(grid, p) {
	return {
		x: p.x * grid.x + grid.offsetX,
		y: p.y * grid.y + grid.offsetY
	};
}

function drawPath(svg, d, colour, isCommitted) {
	const shadow = document.createElementNS(SVG_NS, 'path');
	shadow.setAttribute('d', d);
	shadow.setAttribute('class', 'shadow');
	svg.appendChild(shadow);
	const line = document.createElementNS(SVG_NS, 'path');
	line.setAttribute('d', d);
	line.setAttribute('class', isCommitted ? 'line' : 'line uncommitted');
	line.setAttribute('stroke', isCommitted ? colour : '#808080');
	if (!isCommitted) line.setAttribute('stroke-dasharray', '2,2');
	svg.appendChild(line);
}

function placeBranchLines(branch, grid, expandAt, expandY) {
	const placed = [];
	for (let i = 0; i < branch.lines.length; i++) {
		const line = branch.lines[i];
		let x1 = line.p1.x * grid.x + grid.offsetX;
		let y1 = line.p1.y * grid.y + grid.offsetY;
		let x2 = line.p2.x * grid.x + grid.offsetX;
		let y2 = line.p2.y * grid.y + grid.offsetY;
		if (expandAt > -1 && expandY > 0) {
			if (line.p1.y > expandAt) {
				y1 += expandY;
				y2 += expandY;
			} else if (line.p2.y > expandAt) {
				if (x1 === x2) {
					y2 += expandY;
				} else if (line.lockedFirst) {
					placed.push({
						p1: { x: x1, y: y1 },
						p2: { x: x2, y: y2 },
						isCommitted: line.isCommitted,
						lockedFirst: line.lockedFirst
					});
					placed.push({
						p1: { x: x2, y: y1 + grid.y },
						p2: { x: x2, y: y2 + expandY },
						isCommitted: line.isCommitted,
						lockedFirst: line.lockedFirst
					});
					continue;
				} else {
					placed.push({
						p1: { x: x1, y: y1 },
						p2: { x: x1, y: y2 - grid.y + expandY },
						isCommitted: line.isCommitted,
						lockedFirst: line.lockedFirst
					});
					y1 += expandY;
					y2 += expandY;
				}
			}
		}
		placed.push({
			p1: { x: x1, y: y1 },
			p2: { x: x2, y: y2 },
			isCommitted: line.isCommitted,
			lockedFirst: line.lockedFirst
		});
	}
	return placed;
}

function renderBranch(svg, branch, grid, colours, expandAt, expandY) {
	const colour = colours[branch.colour % colours.length];
	const dCurve = grid.y * 0.8;
	const placed = placeBranchLines(branch, grid, expandAt, expandY);

	let i = 0;
	while (i < placed.length - 1) {
		const line = placed[i];
		const next = placed[i + 1];
		if (
			line.p1.x === line.p2.x &&
			line.p2.x === next.p1.x &&
			next.p1.x === next.p2.x &&
			line.p2.y === next.p1.y &&
			line.isCommitted === next.isCommitted
		) {
			line.p2.y = next.p2.y;
			placed.splice(i + 1, 1);
		} else {
			i++;
		}
	}

	let curPath = '';
	for (i = 0; i < placed.length; i++) {
		const line = placed[i];
		const x1 = line.p1.x;
		const y1 = line.p1.y;
		const x2 = line.p2.x;
		const y2 = line.p2.y;
		if (curPath !== '' && i > 0 && line.isCommitted !== placed[i - 1].isCommitted) {
			drawPath(svg, curPath, colour, placed[i - 1].isCommitted);
			curPath = '';
		}
		if (curPath === '' || (i > 0 && (x1 !== placed[i - 1].p2.x || y1 !== placed[i - 1].p2.y))) {
			curPath += `M${x1.toFixed(0)},${y1.toFixed(1)}`;
		}
		if (x1 === x2) {
			curPath += `L${x2.toFixed(0)},${y2.toFixed(1)}`;
		} else {
			curPath += `C${x1.toFixed(0)},${(y1 + dCurve).toFixed(1)} ${x2.toFixed(0)},${(y2 - dCurve).toFixed(1)} ${x2.toFixed(0)},${y2.toFixed(1)}`;
		}
	}
	if (curPath !== '') {
		drawPath(svg, curPath, colour, placed[placed.length - 1].isCommitted);
	}
}

export function renderGraph(svg, layout, onVertexClick, expand = { at: -1, y: 0 }) {
	while (svg.firstChild) svg.removeChild(svg.firstChild);
	const grid = layout.grid;
	const colours = layout.colours;
	const expandAt = expand.at ?? -1;
	const expandY = expand.y ?? 0;
	const height = layout.vertices.length * grid.y + grid.offsetY + (expandAt > -1 ? expandY : 0);
	const width = Math.max(layout.graphWidth, grid.offsetX * 2);
	svg.setAttribute('width', String(width));
	svg.setAttribute('height', String(Math.max(height, grid.y)));
	svg.setAttribute('viewBox', `0 0 ${width} ${Math.max(height, grid.y)}`);

	const group = document.createElementNS(SVG_NS, 'g');
	for (const branch of layout.branches) {
		renderBranch(group, branch, grid, colours, expandAt, expandY);
	}
	for (const v of layout.vertices) {
		const colour = v.isCommitted ? colours[v.colour % colours.length] : '#808080';
		const cx = v.x * grid.x + grid.offsetX;
		const cy = v.id * grid.y + grid.offsetY + (expandAt > -1 && v.id > expandAt ? expandY : 0);
		const circle = document.createElementNS(SVG_NS, 'circle');
		circle.setAttribute('cx', String(cx));
		circle.setAttribute('cy', String(cy));
		circle.setAttribute('r', '4');
		circle.dataset.id = String(v.id);
		if (v.isCurrent) {
			circle.setAttribute('class', 'current');
			circle.setAttribute('stroke', colour);
			circle.setAttribute('fill', 'var(--bg)');
		} else {
			circle.setAttribute('fill', colour);
		}
		if (v.isStash && !v.isCurrent) {
			circle.setAttribute('r', '4.5');
			circle.setAttribute('class', 'stashOuter');
			circle.setAttribute('fill', 'none');
			circle.setAttribute('stroke', colour);
			const inner = document.createElementNS(SVG_NS, 'circle');
			inner.setAttribute('cx', String(cx));
			inner.setAttribute('cy', String(cy));
			inner.setAttribute('r', '2');
			inner.setAttribute('class', 'stashInner');
			inner.setAttribute('fill', colour);
			group.appendChild(inner);
		}
		circle.addEventListener('click', (ev) => {
			ev.stopPropagation();
			onVertexClick(v.id, ev);
		});
		group.appendChild(circle);
	}
	svg.appendChild(group);
	return width;
}
