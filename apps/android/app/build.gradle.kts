plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

/**
 * Push, when this checkout has a Firebase project to push from.
 *
 * `google-services.json` is what names the project, and the plugin fails the
 * build outright when it is missing - so it is applied only when the file is
 * there. A clone without one still compiles and installs; it simply never gets
 * a registration token, `Push.enabled` is false, and nothing is registered. See
 * FCM/README.md.
 */
val hasFirebase = file("google-services.json").exists()
if (hasFirebase) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.aatech.betweenus"
    // 37 because androidx.core 1.19 and lifecycle 2.11 refuse to be compiled
    // against anything older. targetSdk stays where it is: compiling against a
    // newer API is not the same as opting in to its runtime behaviour.
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.aatech.betweenus"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Read at runtime before anything touches Firebase: without the config
        // file there is no project to get a token from.
        buildConfigField("boolean", "HAS_FIREBASE", hasFirebase.toString())
    }

    androidResources {
        localeFilters += listOf("en")
    }

    // ABI splits for standalone APK distribution (e.g. GitHub releases, direct download).
    // Disabled automatically during bundle tasks because AAB handles ABI splitting natively
    // and AGP does not allow APK splits during App Bundle creation.
    val isBuildingBundle = gradle.startParameter.taskNames.any { it.contains("bundle", ignoreCase = true) }
    splits {
        abi {
            isEnable = !isBuildingBundle
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
            isUniversalApk = true
        }
    }

    bundle {
        density {
            enableSplit = true
        }
        abi {
            enableSplit = true
        }
        language {
            enableSplit = false
        }
    }

    packaging {
        resources {
            excludes += listOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/INDEX.LIST",
                "/META-INF/DEPENDENCIES"
            )
        }
    }

    buildTypes {
        release {
            /**
             * R8, doing all three of its jobs.
             *
             * `isMinifyEnabled` is the code half - dead code removed, names
             * shortened, inlining done. `isShrinkResources` is the other half,
             * and it needs the first: it works out which drawables and strings
             * the *remaining* code can reach, so shrinking resources without
             * shrinking code is not allowed and would not help much anyway.
             *
             * Together they take the bulk of what a Compose app plus WebRTC
             * drags in and never calls. What they cannot do is guess which
             * classes are reached by name from native code - see
             * proguard-rules.pro, where every keep says why it is there.
             *
             * `proguard-android-optimize.txt` is the platform's own file rather
             * than the plain one: the difference is that it lets R8 optimise
             * rather than only shrink, which is the whole reason to run it.
             */
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )

            // No signing config. `assembleRelease` produces an unsigned APK
            // until a real keystore is configured - which is deliberate: a
            // keystore belongs to whoever ships the app and must never be in
            // this repository. See development/ANDROID_TODO.md.
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
        // minSdk 24 has no java.time. Desugaring is one line and gets it, which
        // beats hand-parsing an ISO timestamp in three places.
        isCoreLibraryDesugaringEnabled = true
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    coreLibraryDesugaring(libs.desugar.jdk.libs)
    // :core is the session and the API client; :ui-common is the palette and
    // the widgets. Features live here and are the only thing that knows both.
    implementation(project(":core"))
    implementation(project(":ui-common"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    // Custom Tabs, for the OAuth hand-off. A provider sign-in has to happen
    // in the browser the person already trusts and is already signed in to -
    // a WebView owned by this app is both worse for them and refused by
    // Google outright.
    implementation(libs.androidx.browser)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    // LocalLifecycleOwner and LifecycleResumeEffect: the permission screen has
    // to re-read what is granted on the way back from the system settings.
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.navigation.compose)
    // Voice, video, screen share and the remote screen. A mesh, never an SFU.
    implementation(libs.webrtc)
    // Transcoding a picked video before it is sent. A phone writes 4K at 50
    // Mbps, which is a file nobody wants to upload and nobody wants to be
    // sent; Transformer is the maintained way to drive MediaCodec, and
    // hand-rolling that is a project rather than a feature.
    implementation(libs.media3.transformer)
    implementation(libs.media3.effect)
    implementation(libs.media3.common)
    // Push. Data-only messages, so the notification is written here and never
    // by Android - which is the only way a sealed body can be shown at all, and
    // the only way "this channel is already on screen" can be honoured.
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.play.services)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
