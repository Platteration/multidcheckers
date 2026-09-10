/**
 * The app config, where a value nothing else can see decides how the app looks.
 */
import appConfig from '../../../app.json';

describe('app.json', () => {
  it('lets the system colour scheme through', () => {
    // `userInterfaceStyle: "dark"` becomes UIUserInterfaceStyle=Dark in the iOS
    // Info.plist, which pins the whole app to dark and makes useColorScheme()
    // report 'dark' whatever the phone is set to. The Settings sheet offers
    // System / Dark / Light and theme.tsx resolves 'system' from that hook, so
    // pinning it here leaves the default choice permanently dark on iOS.
    expect(appConfig.expo.userInterfaceStyle).toBe('automatic');
  });
});
