import React, { useCallback } from 'react';
import { Tabs } from 'expo-router';
import { Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '@/constants/theme';
import { isTV } from '@/lib/tv';

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: focused ? '◉' : '○',
    'TV Shows': focused ? '▣' : '□',
    Movies: focused ? '▶' : '▷',
    Search: focused ? '⦿' : '◎',
    Settings: focused ? '⚙' : '⚙',
  };
  return (
    <Text style={{ fontSize: isTV ? 24 : 20, color: focused ? colors.primary : colors.textMuted }}>
      {icons[name] || '○'}
    </Text>
  );
}

/**
 * On TV, tabs should switch when focused (D-pad navigation), not just on press.
 * This custom button triggers onPress when it receives focus.
 */
function TVTabButton(props: any) {
  const { children, onPress, accessibilityState, style, ...rest } = props;
  const isSelected = accessibilityState?.selected;

  const handleFocus = useCallback(() => {
    if (!isSelected && onPress) {
      onPress();
    }
  }, [isSelected, onPress]);

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
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: isTV
          ? {
              backgroundColor: colors.background,
              borderBottomColor: colors.cardBorder,
              borderBottomWidth: 1,
              height: 56,
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
          fontSize: isTV ? 14 : 11,
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
  );
}

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
    backgroundColor: colors.surface,
    borderColor: colors.focus,
  },
});
