import { StyleSheet } from 'react-native';

// participant.html のカラー/レイアウトに合わせる
export const colors = {
  background: '#f7f7f7',
  text: '#222',
  muted: '#666',
  primary: '#1a73e8',
  danger: '#d93025',
  secondaryBg: '#eee',
  secondaryText: '#333',
  error: '#d93025',
  pillBg: '#eef6ff',
  pillText: '#0b57d0',
  pillStalledBg: '#fff4e5',
  pillStalledText: '#b06000',
  bannerBg: '#fff4e5',
  bannerText: '#8a5300',
  border: '#ccc',
};

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  splashWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  label: {
    fontWeight: 'bold',
    fontSize: 14,
    color: colors.text,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginTop: 4,
  },
  button: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  dangerButton: {
    backgroundColor: colors.danger,
  },
  secondaryButton: {
    backgroundColor: colors.secondaryBg,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryButtonText: {
    color: colors.secondaryText,
    fontWeight: 'bold',
    fontSize: 16,
  },
  linkButton: {
    alignItems: 'center',
    padding: 8,
    marginTop: 8,
  },
  linkButtonText: {
    color: colors.primary,
    fontSize: 14,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    marginTop: 8,
    minHeight: 16,
  },
  hintText: {
    color: '#888',
    fontSize: 12,
    marginTop: 8,
  },
  statusText: {
    fontSize: 15,
    color: colors.text,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginTop: 8,
  },
  pillActive: {
    backgroundColor: colors.pillBg,
  },
  pillStalled: {
    backgroundColor: colors.pillStalledBg,
  },
  pillText: {
    fontSize: 13,
    color: colors.pillText,
  },
  pillTextStalled: {
    color: colors.pillStalledText,
  },
  banner: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: colors.bannerBg,
  },
  bannerText: {
    color: colors.bannerText,
    fontSize: 13,
  },
});
