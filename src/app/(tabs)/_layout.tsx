import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/ui/theme';

export default function TabLayout() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: colors.text,
    tabBarInactiveTintColor: colors.textFaint,
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: .5, height: 63 + Math.max(insets.bottom, 10), paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10), elevation: 0 },
    tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 1 },
    tabBarItemStyle: { minHeight: 48 },
  }}>
    <Tabs.Screen name="index" options={{ title: 'Studio', tabBarIcon: ({ focused }) => <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={focused ? colors.text : colors.textFaint} />, tabBarAccessibilityLabel: 'Studio tab' }} />
    <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: ({ focused }) => <Ionicons name={focused ? 'albums' : 'albums-outline'} size={22} color={focused ? colors.text : colors.textFaint} />, tabBarAccessibilityLabel: 'Projects tab' }} />
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ focused }) => <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={24} color={focused ? colors.text : colors.textFaint} />, tabBarAccessibilityLabel: 'Profile tab' }} />
  </Tabs>;
}
