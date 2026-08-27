plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.aatech.betweenus.ui"
    // 37 because androidx.core 1.19 and lifecycle 2.11 refuse to be compiled
    // against anything older. targetSdk stays where it is: compiling against a
    // newer API is not the same as opting in to its runtime behaviour.
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        minSdk = 24

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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


/**
 * Material 3 Expressive is still an opt-in API surface. The client is drawn in
 * that language from the theme down, so the opt-in is a build setting rather
 * than an annotation on every file that draws a button.
 */
kotlin {
    compilerOptions {
        freeCompilerArgs.addAll(
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3ExpressiveApi",
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
        )
    }
}

dependencies {
    coreLibraryDesugaring(libs.desugar.jdk.libs)
    api(project(":core"))
    // Compose is the whole surface of this module - a feature that depends on
    // it is going to write @Composable functions, so it gets the toolkit too.
    api(platform(libs.androidx.compose.bom))
    api(libs.androidx.compose.material3)
    api(libs.androidx.compose.ui)
    api(libs.androidx.compose.ui.graphics)
    api(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    // Avatars and server icons come off the deployment as URLs.
    api(libs.coil.compose)
    // An animated custom emoji is a GIF, and Coil draws its first frame
    // without this. The decoder is registered in `BetweenUsApp`.
    api(libs.coil.gif)
    debugImplementation(libs.androidx.compose.ui.tooling)
    testImplementation(libs.junit)
}
