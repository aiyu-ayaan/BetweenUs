import java.util.Properties

plugins {
    alias(libs.plugins.android.library)
}

/**
 * The deployment this build points at by default.
 *
 * Nexora is self-hosted, so the address the build ships with is a default and
 * not a decision: the server picker overrides it at runtime and stores the
 * choice. `local.properties` is not checked in, which is exactly where a
 * developer's own address belongs.
 *
 *   nexora.serverUrl=http://192.168.1.4:8080
 *
 * With nothing set, an emulator reaches the host machine's gateway on
 * 10.0.2.2 - the loopback address the desktop client would call localhost.
 *
 * It lives in :core rather than :app because `Endpoint` is what reads it, and
 * a module should not have to reach into another one's BuildConfig.
 */
val defaultServerUrl: String = Properties().run {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
    getProperty("nexora.serverUrl")?.trim()?.trimEnd('/').orEmpty()
        .ifEmpty { "http://10.0.2.2:8080" }
}

android {
    namespace = "com.aktech.nexora.core"
    // 37 because androidx.core 1.19 and lifecycle 2.11 refuse to be compiled
    // against anything older. targetSdk stays where it is: compiling against a
    // newer API is not the same as opting in to its runtime behaviour.
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        minSdk = 24

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$defaultServerUrl\"")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    // Every public type here is a suspend function or a StateFlow, so callers
    // need coroutines on their own compile classpath: api, not implementation.
    api(libs.kotlinx.coroutines.android)
    // The HTTP client and the WebSocket client, which are the same client.
    api(libs.okhttp)
    testImplementation(libs.junit)
    // android.jar's org.json is a stub that throws. The real one on the test
    // classpath is what lets the crypto interop test parse a JWK off the JVM.
    testImplementation(libs.json)
    testImplementation(libs.kotlinx.coroutines.test)
}
