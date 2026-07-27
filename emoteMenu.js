(function (global) {
    const STYLE_ID = 'emote-menu-styles';
    const MENU_CLASS = 'emote-menu';
    const VISIBLE_CLASS = `${MENU_CLASS}--visible`;
    const ITEM_CLASS = `${MENU_CLASS}__item`;
    const LABEL_CLASS = `${MENU_CLASS}__label`;
    const DEFAULT_ITEM_SIZE = 44;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
.${MENU_CLASS} {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.92);
    transform-origin: center;
    transition: opacity 0.18s ease-out, transform 0.18s ease-out;
    z-index: 260;
}
.${MENU_CLASS}::before {
    content: "";
    position: absolute;
    inset: -8px;
    border-radius: 999px;
    pointer-events: none;
}
.${MENU_CLASS}.${VISIBLE_CLASS} {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, -50%) scale(1);
}
.${ITEM_CLASS} {
    position: absolute;
    width: ${DEFAULT_ITEM_SIZE}px;
    height: ${DEFAULT_ITEM_SIZE}px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.6);
    background: rgba(28, 140, 247, 0.85);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s ease-out, box-shadow 0.12s ease-out, background 0.12s ease-out;
}
.${ITEM_CLASS}:hover {
    transform: translate(-50%, -50%) scale(1.08);
    background: rgba(52, 169, 255, 0.9);
    box-shadow: 0 12px 20px rgba(0, 0, 0, 0.45);
}
.${ITEM_CLASS}:focus-visible {
    outline: 3px solid rgba(255, 255, 255, 0.8);
    outline-offset: 2px;
}
.${LABEL_CLASS} {
    position: absolute;
    bottom: -18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 10px;
    color: #fff;
    background: rgba(0,0,0,0.55);
    padding: 2px 6px;
    border-radius: 10px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s ease-out;
}
.${ITEM_CLASS}:hover .${LABEL_CLASS},
.${ITEM_CLASS}:focus-visible .${LABEL_CLASS} {
    opacity: 1;
}
`;
        document.head.appendChild(style);
    }

    function abbreviate(name) {
        if (!name) return '?';
        const base = name.split('/').pop() || name;
        const clean = base.replace(/[^a-z0-9]+/gi, ' ').trim();
        if (!clean) return base.slice(0, 2).toUpperCase();
        const parts = clean.split(' ').filter(Boolean);
        if (parts.length === 1) {
            const single = parts[0];
            if (single.length <= 2) return single.toUpperCase();
            return (single[0] + single[single.length - 1]).toUpperCase();
        }
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    class EmoteMenuController {
        constructor(options = {}) {
            injectStyles();
            this.parent = options.parent instanceof HTMLElement ? options.parent : document.body;
            this.radius = typeof options.radius === 'number' ? Math.max(40, options.radius) : 220;
            this.items = Array.isArray(options.items) ? options.items.slice() : [];
            this.onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
            this.visible = false;
            this.itemSize = options.itemSize || DEFAULT_ITEM_SIZE;
            this.colors = Array.isArray(options.colors) && options.colors.length ? options.colors : [
                '#1C8CF7', '#FF5678', '#FF9F43', '#7F5BFE', '#34C759', '#FFA0D2', '#5AC8FA', '#FFCC00'
            ];
            this.root = document.createElement('div');
            this.root.className = MENU_CLASS;
            this.root.tabIndex = -1;
            this.parent.appendChild(this.root);
            this.renderItems();
        }

        renderItems() {
            this.root.textContent = '';
            const count = this.items.length;
            if (!count) return;
            const diameter = this.radius * 2 + this.itemSize;
            this.root.style.width = `${diameter}px`;
            this.root.style.height = `${diameter}px`;
            const center = diameter / 2;
            this.items.forEach((item, index) => {
                const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = ITEM_CLASS;
                button.dataset.animation = item.animation || item.name || '';
                button.title = item.label || item.animation || item.name || '';
                const color = item.color || this.colors[index % this.colors.length];
                button.style.background = `${color}E6`;
                const badge = abbreviate(item.shortLabel || item.label || item.animation || item.name);
                button.textContent = badge;
                button.setAttribute('tabindex', '-1');

                const label = document.createElement('span');
                label.className = LABEL_CLASS;
                label.textContent = item.label || item.animation || item.name || '';
                button.appendChild(label);

                const offsetX = Math.cos(angle) * this.radius;
                const offsetY = Math.sin(angle) * this.radius;
                button.style.left = `${center + offsetX}px`;
                button.style.top = `${center + offsetY}px`;
                button.style.transform = 'translate(-50%, -50%)';
                button.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                });

                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const anim = button.dataset.animation;
                    if (this.onSelect && anim) this.onSelect(anim);
                    this.hide();
                });

                this.root.appendChild(button);
            });
        }

        setItems(items = []) {
            this.items = Array.isArray(items) ? items.slice() : [];
            this.renderItems();
        }

        setPosition(x, y) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            this.root.style.left = `${x}px`;
            this.root.style.top = `${y}px`;
        }

        show() {
            if (this.visible) return;
            this.visible = true;
            this.root.classList.add(VISIBLE_CLASS);
        }

        hide() {
            if (!this.visible) return;
            this.visible = false;
            this.root.classList.remove(VISIBLE_CLASS);
            const activeElement = document.activeElement;
            if (activeElement && this.root.contains(activeElement) && typeof activeElement.blur === 'function') {
                activeElement.blur();
            }
        }

        toggle(force) {
            if (typeof force === 'boolean') {
                force ? this.show() : this.hide();
                return;
            }
            this.visible ? this.hide() : this.show();
        }

        isVisible() {
            return this.visible;
        }

        getRoot() {
            return this.root;
        }

        destroy() {
            this.hide();
            if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
            this.root = null;
            this.items = [];
        }
    }

    function createController(options) {
        return new EmoteMenuController(options);
    }

    global.EmoteMenuManager = { create: createController };
})(window);
