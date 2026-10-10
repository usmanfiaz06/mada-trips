import Svg, { G, Path } from 'react-native-svg';
import { colors } from '@/theme';

/** The Mada sun: the brand mark, the Ask orb, the slider knob. Never a face or a character. */
export function Sun({ width = 32, color = colors.gold }: { width?: number; color?: string }) {
  return (
    <Svg width={width} height={width * 0.67} viewBox="0 0 132.31 88.61" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <G fill={color}>
        <Path d="M47.95,59.75c0,.14,0,.28,0,.42L0,69.45l4.77-11.37,43.22.48c-.03.39-.04.79-.04,1.19Z" />
        <Path d="M84.36,59.75c0,.14,0,.28,0,.42l47.96,9.28-4.77-11.37-43.22.48c.03.39.04.79.04,1.19Z" />
        <Path d="M73.28,0l-4.89,41.68c-.73-.09-1.48-.14-2.23-.14s-1.5.05-2.23.14L59.03,0h14.25Z" />
        <Path d="M58.2,43.37c-1.53.74-2.95,1.7-4.2,2.83l-25.36-23.54,10.22-8.47,19.34,29.19Z" />
        <Path d="M18.07,35.39l32.47,15.02c-.64,1.07-1.17,2.21-1.59,3.4l-37.72-6.41,6.84-12.01Z" />
        <Path d="M74.11,43.37c1.53.74,2.95,1.7,4.2,2.83l25.36-23.54-10.22-8.47-19.34,29.19Z" />
        <Path d="M114.25,35.39l-32.47,15.02c.64,1.07,1.17,2.21,1.59,3.4l37.72-6.41-6.84-12.01Z" />
        <Path d="M63.33,61.18h-2.23c-.71,0-1.39.32-1.84.88l-21.48,26.55h18.76l6.79-27.43Z" />
        <Path d="M68.98,61.18h2.23c.71,0,1.39.32,1.84.88l21.48,26.55h-18.76s-6.79-27.43-6.79-27.43Z" />
      </G>
    </Svg>
  );
}
