// 按名字渲染 Lucide 图标（SVG 数据内嵌在 iconPaths.ts，不需要联网加载）
import { defineComponent, h } from 'vue';
import { ICONS } from '../data/iconPaths';

export default defineComponent({
  name: 'AppIcon',
  props: {
    name: { type: String, required: true },
    size: { type: Number, default: 16 },
    fill: { type: Boolean, default: false },
  },
  setup(props) {
    return () =>
      h(
        'svg',
        {
          class: 'svg-i',
          width: props.size,
          height: props.size,
          viewBox: '0 0 24 24',
          fill: props.fill ? 'currentColor' : 'none',
          stroke: 'currentColor',
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true',
        },
        (ICONS[props.name] ?? ICONS['circle-help'] ?? []).map(([tag, attrs]) => h(tag, attrs)),
      );
  },
});
