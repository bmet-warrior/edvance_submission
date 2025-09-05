import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { semanticSimilarity, extractExamDate, extractExamTime } from '../../../lib/textChunking'

interface Document {
  id: string
  classId: string
  title: string
  content: string
  documentType: string
  createdAt: string
}

interface Question {
  id: string
  title: string
  content: string
  tags: string
  author: {
    name: string
  }
  createdAt: string
}

interface Answer {
  id: string
  content: string
  author: {
    name: string
  }
  createdAt: string
  isAiGenerated: boolean
}

// Simple text similarity function for demo (in production, use embeddings)
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/)
  const words2 = text2.toLowerCase().split(/\s+/)
  
  const intersection = words1.filter(word => words2.includes(word))
  const union = Array.from(new Set([...words1, ...words2]))
  
  return intersection.length / union.length
}



async function searchDocuments(query: string, classId: string): Promise<{ document: Document; similarity: number; excerpt: string }[]> {
  try {
    console.log('Searching for query:', query, 'in classId:', classId)
    
    // Fetch documents directly from the database
    const documents = await prisma.document.findMany({
      where: { 
        classId: classId 
      },
      include: {
        uploader: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    console.log(`Found ${documents.length} documents for class ${classId}`)
    
    const results = documents.map(doc => {
      const similarity = semanticSimilarity(query, doc.content)
      
      // Keyword boost for exam-related queries
      const queryLower = query.toLowerCase()
      const contentLower = doc.content.toLowerCase()
      let keywordBoost = 0
      
      if (queryLower.includes('exam') || queryLower.includes('final')) {
        if (contentLower.includes('final exam') || contentLower.includes('exam date')) {
          keywordBoost = 0.3
        }
        if (contentLower.includes('exam') || contentLower.includes('final')) {
          keywordBoost = 0.1
        }
      }
      
      const boostedSimilarity = Math.min(1.0, similarity + keywordBoost)
      
      return {
        document: {
          id: doc.id,
          classId: classId,
          title: doc.title,
          content: doc.content,
          documentType: doc.documentType,
          createdAt: doc.createdAt.toISOString()
        },
        similarity: boostedSimilarity,
        excerpt: doc.content.substring(0, 300) + (doc.content.length > 300 ? '...' : '')
      }
    })
    
    const filteredResults = results.filter(result => result.similarity > 0.2).sort((a, b) => b.similarity - a.similarity)
    
    console.log('Top 3 results:')
    filteredResults.slice(0, 3).forEach((result, i) => {
      console.log(`[${i}] Similarity: ${result.similarity.toFixed(3)}, Title: ${result.document.title}`)
      console.log(`    Excerpt: ${result.excerpt.substring(0, 100)}...`)
    })
    
    return filteredResults
    
  } catch (error) {
    console.error('Error searching documents:', error)
    return []
  }
}

async function searchPastQAs(query: string, classId: string): Promise<{ question: Question; answer: Answer; similarity: number }[]> {
  try {
    // Fetch actual questions and answers from the database
    const questions = await prisma.question.findMany({
      where: { 
        classId: classId 
      },
      include: {
        author: {
          select: {
            name: true
          }
        },
        answers: {
          include: {
            author: {
              select: {
                name: true,
                role: true
              }
            }
          },
          orderBy: {
            createdAt: 'asc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 20 // Limit to recent questions
    })
    
    const results = questions
      .filter(q => q.answers.length > 0) // Only questions with answers
      .map(q => {
        const questionSimilarity = semanticSimilarity(query, q.title + ' ' + q.content)
        
        // Find the best answer - prefer professor answers, then AI answers, then student answers
        let bestAnswer = q.answers[0]
        let bestAnswerSimilarity = semanticSimilarity(query, q.answers[0].content)
        
        for (const answer of q.answers) {
          const answerSimilarity = semanticSimilarity(query, answer.content)
          
          // Prefer professor answers
          if (answer.author.role === 'TEACHER' && bestAnswer.author.role !== 'TEACHER') {
            bestAnswer = answer
            bestAnswerSimilarity = answerSimilarity
          }
          // Then prefer AI answers
          else if (answer.isAiGenerated && !bestAnswer.isAiGenerated && bestAnswer.author.role !== 'TEACHER') {
            bestAnswer = answer
            bestAnswerSimilarity = answerSimilarity
          }
          // Then prefer higher similarity
          else if (answerSimilarity > bestAnswerSimilarity && answer.author.role === bestAnswer.author.role) {
            bestAnswer = answer
            bestAnswerSimilarity = answerSimilarity
          }
        }
        
        const similarity = Math.max(questionSimilarity, bestAnswerSimilarity)
        
        return {
          question: {
            id: q.id,
            title: q.title,
            content: q.content,
            tags: q.tags,
            author: q.author,
            createdAt: q.createdAt.toISOString()
          },
          answer: {
            id: bestAnswer.id,
            content: bestAnswer.content,
            author: bestAnswer.author,
            createdAt: bestAnswer.createdAt.toISOString(),
            isAiGenerated: bestAnswer.isAiGenerated
          },
          similarity
        }
      })
    
    const filteredResults = results.filter(result => result.similarity > 0.3).sort((a, b) => b.similarity - a.similarity)
    
    console.log(`Found ${filteredResults.length} past Q&A matches for query: "${query}"`)
    if (filteredResults.length > 0) {
      console.log('Top Q&A match:', {
        question: filteredResults[0].question.title,
        similarity: filteredResults[0].similarity,
        answerPreview: filteredResults[0].answer.content.substring(0, 100) + '...'
      })
    }
    
    return filteredResults
    
  } catch (error) {
    console.error('Error searching past Q&As:', error)
    return []
  }
}

async function generateAIResponse(query: string, sources: any[], classId: string): Promise<{ response: string; confidence: number; sources: any[] }> {
  try {
    if (sources.length === 0) {
      return {
        response: '',
        confidence: 0,
        sources: []
      }
    }

    // Get class accuracy data to adjust confidence
    let classAccuracy = 0.5 // Default neutral accuracy
    try {
      const accuracyData = await prisma.classAccuracy.findUnique({
        where: { classId }
      })
      if (accuracyData) {
        classAccuracy = accuracyData.accuracyRate / 100 // Convert percentage to decimal
      }
    } catch (error) {
      console.log('Could not fetch class accuracy data:', error)
    }
    
    // Filter sources with extremely strict thresholds to avoid fake responses
    const relevantSources = sources.filter(source => {
      if (source.type === 'qa') {
        // Extremely high threshold for past Q&As to ensure relevance
        return source.similarity > 0.90
      } else {
        // Extremely high threshold for documents to ensure relevance
        return source.similarity > 0.95
      }
    })
    
    console.log(`Filtered sources: ${relevantSources.length} total (${relevantSources.filter(s => s.type === 'qa').length} Q&As, ${relevantSources.filter(s => s.type === 'document').length} documents)`)
    
    // Debug: Log all sources and their similarity scores
    console.log('All sources with similarity scores:')
    sources.forEach((source, index) => {
      console.log(`${index + 1}. ${source.type}: ${source.similarity.toFixed(3)} - ${source.document?.title || source.question?.title || 'Unknown'}`)
    })
    
    console.log('Relevant sources after filtering:')
    relevantSources.forEach((source, index) => {
      console.log(`${index + 1}. ${source.type}: ${source.similarity.toFixed(3)} - ${source.document?.title || source.question?.title || 'Unknown'}`)
    })
    
    if (relevantSources.length === 0) {
      console.log('No relevant sources found - returning no answer with 0 confidence')
      return {
        response: '',
        confidence: 0,
        sources: []
      }
    }
    
    const bestSource = relevantSources[0]
    let confidence = bestSource.similarity
    
    // Extremely conservative confidence adjustment to avoid fake responses
    let adjustedConfidence = confidence
    if (confidence > 0.98) {
      // Only extremely high confidence gets a slight boost
      adjustedConfidence = Math.min(0.99, confidence * 1.01)
    } else if (confidence > 0.95) {
      // Very high confidence gets reduced slightly
      adjustedConfidence = confidence * 0.98
    } else if (confidence > 0.90) {
      // High confidence gets reduced more
      adjustedConfidence = confidence * 0.90
    } else {
      // If similarity is not extremely high, don't provide an answer
      return {
        response: '',
        confidence: 0,
        sources: []
      }
    }

    // Further adjust based on class accuracy history
    if (classAccuracy > 0.7) {
      // High accuracy class - boost confidence slightly
      adjustedConfidence = Math.min(0.95, adjustedConfidence * 1.1)
    } else if (classAccuracy < 0.3) {
      // Low accuracy class - reduce confidence
      adjustedConfidence = adjustedConfidence * 0.8
    }
    
    // Check for exam date questions first (deterministic extraction)
    const examDateKeywords = ['when is the final exam', 'exam date', 'final exam date', 'when is the exam', 'exam schedule']
    const isExamDateQuestion = examDateKeywords.some(keyword => 
      query.toLowerCase().includes(keyword.toLowerCase())
    )
    
    // Check for exam topics questions
    const examTopicsKeywords = ['exam topics', 'final exam topics', 'what topics', 'what will be on the exam', 'exam content', 'what does the exam cover']
    const isExamTopicsQuestion = examTopicsKeywords.some(keyword => 
      query.toLowerCase().includes(keyword.toLowerCase())
    )
    
    if (isExamDateQuestion) {
      console.log('Exam date question detected, extracting date...')
      
      // Combine all relevant text for date extraction
      const allText = relevantSources.map(s => s.document?.content || s.excerpt || '').join(' ')
      console.log('Combined text for date extraction:', allText.substring(0, 500) + '...')
      
      // Try to extract exam date
      const examDate = extractExamDate(allText)
      const examTime = extractExamTime(allText)
      
      console.log('Extracted date:', examDate, 'time:', examTime)
      
      if (examDate) {
        let answer = `The final exam is on ${examDate}`
        if (examTime) {
          answer += ` at ${examTime}`
        }
        answer += '.'
        
        console.log('Returning extracted answer:', answer)
        
        return {
          response: answer,
          confidence: 0.95, // High confidence for extracted dates
          sources: relevantSources.slice(0, 3)
        }
      } else {
        console.log('No date found in text, will fall back to AI generation')
      }
    }
    
    // Check for exam topics questions
    if (isExamTopicsQuestion) {
      console.log('Exam topics question detected, extracting topics...')
      
      // Combine all relevant text for topics extraction
      const allText = relevantSources.map(s => s.document?.content || s.excerpt || '').join(' ')
      console.log('Combined text for topics extraction:', allText.substring(0, 500) + '...')
      
      // Look for exam topics in the text
      if (allText.toLowerCase().includes('exam topics') || allText.toLowerCase().includes('final exam topics')) {
        const topicsMatch = allText.match(/final exam topics include:([^.]+)/i)
        if (topicsMatch) {
          const topics = topicsMatch[1].trim()
          const answer = `Based on the course materials, the final exam topics include:${topics}`
          
          console.log('Returning extracted topics answer:', answer)
          
          return {
            response: answer,
            confidence: 0.95,
            sources: relevantSources.slice(0, 3)
          }
        }
      }
      
      // Fallback: look for specific topic keywords - but only if we have very high confidence
      const topicKeywords = ['financial markets', 'risk management', 'portfolio theory', 'derivatives', 'fixed income', 'corporate finance']
      const foundTopics = topicKeywords.filter(topic => allText.toLowerCase().includes(topic.toLowerCase()))
      
      if (foundTopics.length > 0 && relevantSources.length > 0 && relevantSources[0].similarity > 0.95) {
        const answer = `Based on the course materials, the final exam will cover: ${foundTopics.join(', ')}.`
        
        console.log('Returning extracted topics from keywords:', answer)
        
        return {
          response: answer,
          confidence: 0.85, // Reduced confidence for keyword-based answers
          sources: relevantSources.slice(0, 3)
        }
      }
      
      console.log('No specific topics found, will fall back to AI generation')
    }
    
    // DISABLED: External AI generation to prevent fake responses
    // The system now only provides answers based on exact matches from course materials
    // This ensures no fake information is generated
    
    // Extremely conservative fallback response logic to avoid fake responses
    let response = ''
    
    // Only provide responses for extremely high confidence matches
    if (bestSource.document && bestSource.similarity > 0.98) {
      // Only near-perfect confidence document matches
      response = `Based on the "${bestSource.document.title}" uploaded for this course: ${bestSource.excerpt}`
    } else if (bestSource.answer && bestSource.similarity > 0.95) {
      // Only extremely high confidence past Q&A matches
      const answerAuthor = bestSource.answer.author?.name || 'a classmate'
      const questionTitle = bestSource.question?.title || 'a previous question'
      const questionId = bestSource.question?.id
      
      // Clean HTML formatting from the answer content
      const cleanContent = bestSource.answer.content.replace(/<[^>]*>/g, '').trim()
      
      response = `This question was answered previously by ${answerAuthor} in the discussion "${questionTitle}". Here's their response: ${cleanContent}`
    } else {
      // If confidence is not near-perfect, don't provide an answer
      console.log('No high-confidence matches found - returning no answer with 0 confidence')
      return {
        response: '',
        confidence: 0,
        sources: []
      }
    }
    
    // Enhance sources with additional information for Q&As
    const enhancedSources = relevantSources.map(source => {
      if (source.type === 'qa' && source.question) {
        return {
          ...source,
          title: source.question.title,
          questionId: source.question.id,
          relevance: `Answered by ${source.answer.author?.name || 'a classmate'} in this discussion`
        }
      }
      return source
    })
    
    return {
      response,
      confidence: adjustedConfidence,
      sources: enhancedSources.slice(0, 3) // Return top 3 relevant sources
    }
    
  } catch (error) {
    console.error('Error generating AI response:', error)
    return {
      response: '',
      confidence: 0,
      sources: []
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { question, classId } = await request.json()
    
    if (!question || !classId) {
      return NextResponse.json({ error: 'Missing question or classId' }, { status: 400 })
    }
    
    // Search both documents and past Q&As
    const [documentResults, qaResults] = await Promise.all([
      searchDocuments(question, classId),
      searchPastQAs(question, classId)
    ])
    
    // Combine results
    const allSources = [
      ...documentResults.map(r => ({ ...r, type: 'document' })),
      ...qaResults.map(r => ({ ...r, type: 'qa' }))
    ].sort((a, b) => b.similarity - a.similarity)
    
    // Generate AI response
    const aiResponse = await generateAIResponse(question, allSources, classId)
    
    console.log('Final AI response:', {
      response: aiResponse.response,
      confidence: aiResponse.confidence,
      hasResponse: !!aiResponse.response,
      responseLength: aiResponse.response?.length || 0
    })
    
    const shouldPostToForum = aiResponse.confidence < 0.98
    const hasAnswer = aiResponse.response && aiResponse.response.trim() !== ''
    
    return NextResponse.json({
      success: true,
      aiResponse: aiResponse.response,
      confidence: aiResponse.confidence,
      sources: aiResponse.sources,
      shouldPostToForum,
      hasAnswer,
      showFeedback: hasAnswer && !shouldPostToForum, // Show feedback when AI provides an answer
      recommendation: shouldPostToForum 
        ? 'The AI cannot answer this question confidently based on available course materials. Please post this question to the forum for human discussion.'
        : 'The AI found an exact match in the course materials. You can accept this answer or still post to the forum for additional perspectives.'
    })
    
  } catch (error) {
    console.error('Error in AI prefilter:', error)
    return NextResponse.json(
      { error: 'Failed to analyze question', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
