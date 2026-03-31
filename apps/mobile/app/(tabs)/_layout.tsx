import React, { useCallback } from 'react';
import { Tabs } from 'expo-router';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '@/constants/theme';
import { isTV, TV_SAFE_AREA } from '@/lib/tv';
import { Clock } from '@/components/Clock';

const ICONS: Record<string, [string, string]> = {
  Home: ['◉', '○'],
  'TV Shows': ['▣', '□'],
  Movies: ['▶', '▷'],
  Library: ['▤', '▤'],
  Search: ['⦿', '◎'],
  Settings: ['⚙', '⚙'],
};

const TabIcon = React.memo(function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const pair = ICONS[name] || ['○', '○'];
  return (
    <Text style={[tabIconStyle, { color: focused ? colors.primary : colors.textMuted }]}>
      {focused ? pair[0] : pair[1]}
    </Text>
  );
});

const tabIconStyle = { fontSize: isTV ? 28 : 20 };

/**
 * On TV, tabs should switch when focused (D-pad navigation), not just on press.
 * This custom button triggers onPress when it receives focus.
 */
const TVTabButton = React.memo(function TVTabButton(props: any) {
  const { children, onPress, accessibilityState, style, ...rest } = props;
  const isSelected = accessibilityState?.selected;
  const onPressRef = React.useRef(onPress);
  onPressRef.current = onPress;

  const handleFocus = useCallback(() => {
    if (!isSelected) {
      onPressRef.current?.();
    }
  }, [isSelected]);

  return (
    <Pressable
      {...rest}
      onPress={onPress}
      onFocus={handleFocus}
      focusable={true}
      style={[
        style,
        tvStyles.tabButton,
        isSelected && tvStyles.tabButtonSelected,
      ]}
    >
      {children}
    </Pressable>
  );
});

export default function TabLayout() {
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: isTV
          ? {
              backgroundColor: colors.surface,
              borderBottomColor: colors.cardBorder,
              borderBottomWidth: 1,
              height: 50 + Math.ceil(TV_SAFE_AREA.vertical * 0.55),
              paddingTop: Math.ceil(TV_SAFE_AREA.vertical * 0.55),
              paddingRight: 100,
            }
          : {
              backgroundColor: colors.surface,
              borderTopColor: colors.cardBorder,
              borderTopWidth: 1,
            },
        tabBarPosition: isTV ? 'top' : 'bottom',
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontSize: isTV ? 18 : 11,
          fontWeight: '600',
        },
        ...(isTV ? {
          tabBarButton: (props: any) => <TVTabButton {...props} />,
        } : {}),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tv"
        options={{
          title: 'TV Shows',
          tabBarIcon: ({ focused }) => <TabIcon name="TV Shows" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          title: 'Movies',
          tabBarIcon: ({ focused }) => <TabIcon name="Movies" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ focused }) => <TabIcon name="Library" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ focused }) => <TabIcon name="Search" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon name="Settings" focused={focused} />,
        }}
      />
    </Tabs>
    <View style={layoutStyles.clockOverlay} pointerEvents="none">
      <Clock />
    </View>
    </View>
  );
}

const layoutStyles = StyleSheet.create({
  clockOverlay: {
    position: 'absolute',
    top: isTV ? 16 + Math.ceil(TV_SAFE_AREA.vertical * 0.55) : 50,
    right: spacing.lg,
    zIndex: 100,
  },
});

const tvStyles = StyleSheet.create({
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    marginHorizontal: 2,
  },
  tabButtonSelected: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.focus,
  },
});
