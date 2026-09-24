import SwiftUI

@main
struct RocketBayApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .persistentSystemOverlays(.hidden)
        }
    }
}
