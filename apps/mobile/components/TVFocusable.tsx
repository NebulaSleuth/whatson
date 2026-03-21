import React, { useState } from 'react';
import { Pressable, TextInput, StyleSheet, type ViewStyle, type NativeSyntheticEvent, type TextInputSubmitEditingEventData } from 'react-native';
import { colors } from '@/constants/theme';
import { isTV } from '@/lib/tv';

/**
 * A Pressable that shows a focus border on Android TV.
 * Use this for buttons, list items, and other interactive elements on TV.
 */
export function TVPressable({
  children,
  style,
  focusStyle: customFocusStyle,
  ...props
}: React.ComponentProps<typeof Pressable> & { focusStyle?: ViewStyle }) {
  const [focused, setFocused] = useState(false);

  if (!isTV) {
    return <Pressable style={style} {...props}>{children}</Pressable>;
  }

  return (
    <Pressable
      {...props}
      onFocus={(e) => { setFocused(true); (props as any).onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); (props as any).onBlur?.(e); }}
      focusable={true}
      style={[
        style,
        focused && [styles.focused, customFocusStyle],
      ]}
    >
      {children}
    </Pressable>
  );
}

/**
 * A TextInput that shows a focus border on Android TV.
 */
export function TVTextInput({
  style,
  onSubmitEditing,
  ...props
}: React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  const inputRef = React.useRef<TextInput>(null);

  const handleSubmit = React.useCallback((e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
    if (!isTV) {
      onSubmitEditing?.(e);
    }
    // On TV, do nothing — keep focus on the input, keyboard dismisses naturally
  }, [onSubmitEditing]);

  return (
    <TextInput
      ref={inputRef}
      {...props}
      returnKeyType={isTV ? 'none' : props.returnKeyType}
      onSubmitEditing={handleSubmit}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      blurOnSubmit={false}
      selectTextOnFocus={false}
      style={[
        style,
        isTV && focused && styles.inputFocused,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  focused: {
    borderWidth: 2,
    borderColor: colors.focus,
  },
  inputFocused: {
    borderWidth: 2,
    borderColor: colors.focus,
  },
});
