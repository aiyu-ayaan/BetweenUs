plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.aktech.nexora"
    // 37 because androidx.core 1.19 and lifecycle 2.11 refuse to be compiled
    // against anything older. targetSdk stays where it is: compiling against a
    // newer API is not the same as opting in to its runtime behaviour.
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.aktech.nexora"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    // Voice, video, screen share and the remote screen. A mesh, never an SFU.
    implementation(libs.webrtc)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
