const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function autoEnrollQuestionAuthors() {
  try {
    console.log('🚀 Starting auto-enrollment of question authors...')
    
    // Get all classes
    const classes = await prisma.class.findMany({
      include: {
        questions: {
          include: {
            author: true
          }
        },
        enrollments: {
          include: {
            user: true
          }
        }
      }
    })
    
    console.log(`📚 Found ${classes.length} classes`)
    
    let totalEnrollments = 0
    
    for (const classData of classes) {
      console.log(`\n📖 Processing class: ${classData.name} (${classData.code})`)
      
      // Get all unique question authors for this class
      const questionAuthors = classData.questions.map(q => q.author)
      const uniqueAuthors = questionAuthors.filter((author, index, self) => 
        index === self.findIndex(a => a.id === author.id)
      )
      
      console.log(`   Found ${uniqueAuthors.length} unique question authors`)
      
      // Get existing enrolled user IDs
      const enrolledUserIds = classData.enrollments.map(e => e.userId)
      console.log(`   Already enrolled: ${enrolledUserIds.length} students`)
      
      // Find authors who are not yet enrolled
      const authorsToEnroll = uniqueAuthors.filter(author => 
        !enrolledUserIds.includes(author.id) && author.role === 'STUDENT'
      )
      
      console.log(`   Need to enroll: ${authorsToEnroll.length} students`)
      
      // Enroll each author
      for (const author of authorsToEnroll) {
        try {
          await prisma.classEnrollment.create({
            data: {
              userId: author.id,
              classId: classData.id
            }
          })
          
          console.log(`   ✅ Enrolled: ${author.name} (${author.email})`)
          totalEnrollments++
        } catch (error) {
          if (error.code === 'P2002') {
            console.log(`   ⚠️  Already enrolled: ${author.name} (${author.email})`)
          } else {
            console.log(`   ❌ Error enrolling ${author.name}: ${error.message}`)
          }
        }
      }
    }
    
    console.log(`\n🎉 Auto-enrollment complete!`)
    console.log(`📊 Total new enrollments: ${totalEnrollments}`)
    
    // Show summary by class
    console.log(`\n📋 Summary by class:`)
    for (const classData of classes) {
      const enrollmentCount = await prisma.classEnrollment.count({
        where: { classId: classData.id }
      })
      console.log(`   ${classData.code} (${classData.name}): ${enrollmentCount} enrolled students`)
    }
    
  } catch (error) {
    console.error('❌ Error during auto-enrollment:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
autoEnrollQuestionAuthors()
