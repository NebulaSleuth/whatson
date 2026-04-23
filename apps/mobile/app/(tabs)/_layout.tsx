import React, { useCallback, createContext, useContext, useState } from 'react';
import { Tabs } from 'expo-router';
import { View, Text, Pressable, StyleSheet, findNodeHandle } from 'react-native';
import { colors, spacing } from '@/constants/theme';
import { isTV, TV_SAFE_AREA } from '@/lib/tv';
import { Clock } from '@/components/Clock';

/** Context to share the active tab button's node ID with tab content */
const TabNodeContext = createContext<number | undefined>(undefined);
export function useTabNodeId() { return useContext(TabNodeContext); }

const ICONS: Record<string, [string, string]> = {
  Home: ['◉', '○'],
  'TV Shows': ['▣', '□'],
  Movies: ['▶', '▷'],
  Sports: ['◆', '◇'],
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
function TVTabButton(props: any) {
  const { children, onPress, accessibilityState, style, onNodeId, ...rest } = props;
  const isSelected = accessibilityState?.selected;

  return (
    <Pressable
      {...rest}
      ref={(ref: any) => {
        if (isTV && ref && isSelected && onNodeId) {
          const nodeId = findNodeHandle(ref);
          if (nodeId) onNodeId(nodeId);
        }
      }}
      onPress={onPress}
      focusable={true}
      style={({ focused }) => [
        style,
        tvStyles.tabButton,
        isSelected && tvStyles.tabButtonSelected,
        focused && tvStyles.tabButtonFocused,
      ]}
    >
      {children}
    </Pressable>
  );
}

export default function TabLayout() {
  const [activeTabNodeId, setActiveTabNodeId] = useState<number | undefined>(undefined);

  return (
    <TabNodeContext.Provider value={activeTabNodeId}>
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: isTV
          ? {
              backgroundColor: colors.surface,
              borderBottomColor: colors.cardBorder,
              borderBottomWidth: 1,
              height: 62 + Math.ceil(TV_SAFE_AREA.vertical * 0.35),
              paddingTop: Math.ceil(TV_SAFE_AREA.vertical * 0.35),
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
        tabBarLabelPosition: isTV ? 'below-icon' : undefined,
        tabBarIconStyle: isTV ? { minHeight: 32 } : undefined,
        tabBarLabelStyle: {
          fontSize: isTV ? 18 : 11,
          fontWeight: '600',
        },
        ...(isTV ? {
          tabBarButton: (props: any) => <TVTabButton {...props} onNodeId={setActiveTabNodeId} />,
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
        name="sports"
        options={{
          title: 'Sports',
          tabBarIcon: ({ focused }) => <TabIcon name="Sports" focused={focused} />,
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
    </TabNodeContext.Provider>
  );
}

const layoutStyles = StyleSheet.create({
  clockOverlay: {
    position: 'absolute',
    top: isTV ? 16 + Math.ceil(TV_SAFE_AREA.vertical * 0.35) : 50,
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
    marginHorizontal: 2,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabButtonSelected: {
    borderBottomColor: colors.focus,
  },
  tabButtonFocused: {
    backgroundColor: 'rgba(229, 160, 13, 0.15)',
    borderBottomColor: colors.focus,
  },
});
