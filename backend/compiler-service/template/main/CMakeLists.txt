# Auto-collect all application sources under main/.
# The frontend submits only L4-L5 sources (e.g. main.c, app_ui.c); it never
# needs to edit this build file. This is enforced server-side: build-system
# files are owned by the template, not the client.
file(GLOB_RECURSE APP_SOURCES "${CMAKE_CURRENT_LIST_DIR}/*.c" "${CMAKE_CURRENT_LIST_DIR}/*.cpp")

idf_component_register(
    SRCS ${APP_SOURCES}
    INCLUDE_DIRS "."
)
